param(
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [Parameter(Mandatory = $true)]
    [string]$InputManifest,

    [int]$MaxWidth = 2200,

    [int]$MaxHeight = 800,

    [ValidateRange(70, 100)]
    [int]$JpegQuality = 95
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$parsedItems = Get-Content -Raw -Encoding UTF8 -LiteralPath $InputManifest | ConvertFrom-Json
# Windows PowerShell 5.1 may preserve a top-level JSON array as one pipeline object.
# Enumerate it explicitly so paths from several TRIM clicks are never concatenated.
$items = @()
if ($parsedItems -is [System.Array]) {
    foreach ($parsedItem in $parsedItems) { $items += $parsedItem }
} elseif ($null -ne $parsedItems) {
    $items += $parsedItems
}
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/jpeg' } |
    Select-Object -First 1
if (-not $jpegCodec) { throw 'JPEG encoder is unavailable.' }

$results = @()
for ($index = 0; $index -lt $items.Count; $index++) {
    $item = $items[$index]
    $sourceEntries = @(
        [pscustomobject]@{ label = 'persistent_baseline'; path = [string]$item.baselinePath },
        [pscustomobject]@{ label = 'immediate_before'; path = [string]$item.beforePath },
        [pscustomobject]@{ label = 'selection_feedback'; path = [string]$item.selectionPath },
        [pscustomobject]@{ label = 'settled_after'; path = [string]$item.afterPath }
    ) | Where-Object { $_.path -and (Test-Path -LiteralPath $_.path) }
    if ($sourceEntries.Count -lt 2) {
        $results += [pscustomobject]@{
            skipped = $true
            reason = 'fewer_than_two_available_frames'
            sourceScreenshots = @($sourceEntries | ForEach-Object { $_.path })
        }
        continue
    }

    $images = @()
    try {
        foreach ($entry in $sourceEntries) {
            $images += [System.Drawing.Image]::FromFile((Get-Item -LiteralPath $entry.path).FullName)
        }
        $sourceWidth = $images[0].Width
        $sourceHeight = $images[0].Height
        foreach ($image in $images) {
            if ($image.Width -ne $sourceWidth -or $image.Height -ne $sourceHeight) {
                throw "TRIM evidence $($item.id) contains mismatched source dimensions."
            }
        }

        $cropWidth = [Math]::Min($sourceWidth, [Math]::Max(1, [int]$item.cropWidth))
        $cropHeight = [Math]::Min($sourceHeight, [Math]::Max(1, [int]$item.cropHeight))
        $clickX = [int][Math]::Round([double]$item.clickX)
        $clickY = [int][Math]::Round([double]$item.clickY)
        $cropLeft = [Math]::Max(0, [Math]::Min($sourceWidth - $cropWidth,
            [int][Math]::Round($clickX - $cropWidth / 2)))
        $cropTop = [Math]::Max(0, [Math]::Min($sourceHeight - $cropHeight,
            [int][Math]::Round($clickY - $cropHeight / 2)))
        $headerHeight = 42
        $unscaledWidth = $cropWidth * $images.Count
        $unscaledHeight = $cropHeight + $headerHeight
        $composite = New-Object System.Drawing.Bitmap($unscaledWidth, $unscaledHeight,
            [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($composite)
            try {
                $graphics.Clear([System.Drawing.Color]::FromArgb(24, 28, 34))
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
                $font = New-Object System.Drawing.Font('Segoe UI', 17, [System.Drawing.FontStyle]::Bold)
                $labelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
                # Keep the exact clicked pixels unobscured: a ring shows location,
                # while the geometry through its center remains visible.
                $markerPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 222, 0), 3)
                $dividerPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 160, 220), 2)
                try {
                    for ($panelIndex = 0; $panelIndex -lt $images.Count; $panelIndex++) {
                        $panelLeft = $panelIndex * $cropWidth
                        $destination = New-Object System.Drawing.Rectangle($panelLeft, $headerHeight, $cropWidth, $cropHeight)
                        $sourceRect = New-Object System.Drawing.Rectangle($cropLeft, $cropTop, $cropWidth, $cropHeight)
                        $graphics.DrawImage($images[$panelIndex], $destination, $sourceRect,
                            [System.Drawing.GraphicsUnit]::Pixel)
                        $graphics.DrawString([string]$sourceEntries[$panelIndex].label, $font, $labelBrush,
                            [single]($panelLeft + 12), [single]7)
                        if ($panelIndex -gt 0) {
                            $graphics.DrawLine($dividerPen, $panelLeft, 0, $panelLeft, $unscaledHeight)
                        }
                        $markerX = $panelLeft + $clickX - $cropLeft
                        $markerY = $headerHeight + $clickY - $cropTop
                        $graphics.DrawEllipse($markerPen, $markerX - 23, $markerY - 23, 46, 46)
                    }
                } finally {
                    $font.Dispose()
                    $labelBrush.Dispose()
                    $markerPen.Dispose()
                    $dividerPen.Dispose()
                }
            } finally {
                $graphics.Dispose()
            }

            $scale = [Math]::Min(1.0, [Math]::Min($MaxWidth / $unscaledWidth, $MaxHeight / $unscaledHeight))
            $outputWidth = [Math]::Max(1, [int][Math]::Round($unscaledWidth * $scale))
            $outputHeight = [Math]::Max(1, [int][Math]::Round($unscaledHeight * $scale))
            $outputBitmap = New-Object System.Drawing.Bitmap($outputWidth, $outputHeight,
                [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
            $outputPath = Join-Path $OutputDirectory ('trim-pair-{0:D3}.jpg' -f $index)
            try {
                $outputGraphics = [System.Drawing.Graphics]::FromImage($outputBitmap)
                try {
                    $outputGraphics.Clear([System.Drawing.Color]::Black)
                    $outputGraphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                    $outputGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                    $outputGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                    $outputGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                    $outputGraphics.DrawImage($composite, 0, 0, $outputWidth, $outputHeight)
                } finally {
                    $outputGraphics.Dispose()
                }
                $parameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
                try {
                    $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
                        [System.Drawing.Imaging.Encoder]::Quality, [long]$JpegQuality)
                    $outputBitmap.Save($outputPath, $jpegCodec, $parameters)
                } finally {
                    $parameters.Dispose()
                }
            } finally {
                $outputBitmap.Dispose()
            }
        } finally {
            $composite.Dispose()
        }
    } finally {
        foreach ($image in $images) { $image.Dispose() }
    }

    $results += [pscustomobject]@{
        skipped = $false
        path = $outputPath
        sourceWidth = $sourceWidth
        sourceHeight = $sourceHeight
        cropLeft = $cropLeft
        cropTop = $cropTop
        cropWidth = $cropWidth
        cropHeight = $cropHeight
        headerHeight = $headerHeight
        outputWidth = $outputWidth
        outputHeight = $outputHeight
        scale = $scale
        clickX = $clickX
        clickY = $clickY
        panelOrder = @($sourceEntries | ForEach-Object { $_.label })
        sourceScreenshots = @($sourceEntries | ForEach-Object { $_.path })
        jpegQuality = $JpegQuality
    }
}

ConvertTo-Json -InputObject @($results) -Depth 5 -Compress
