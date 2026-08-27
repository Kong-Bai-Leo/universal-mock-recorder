param(
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [int]$MaxWidth = 1600,

    [int]$MaxHeight = 1000,

    [ValidateRange(30, 95)]
    [int]$JpegQuality = 68,

    [Parameter(Mandatory = $true)]
    [string]$InputManifest
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$parsedManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $InputManifest | ConvertFrom-Json
$InputItems = @($parsedManifest)
if ($InputItems.Count -eq 0) { throw 'Screenshot manifest is empty.' }

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/jpeg' } |
    Select-Object -First 1
if (-not $jpegCodec) { throw 'JPEG encoder is unavailable.' }
$results = @()
for ($index = 0; $index -lt $InputItems.Count; $index++) {
    $manifestItem = $InputItems[$index]
    $sourcePath = if ($manifestItem -is [string]) { [string]$manifestItem } else { [string]$manifestItem.path }
    $sourcePath = (Get-Item -LiteralPath $sourcePath).FullName
    $source = [System.Drawing.Image]::FromFile($sourcePath)
    $sourceWidth = $source.Width
    $sourceHeight = $source.Height
    $cropped = $null
    $hasCrop = $manifestItem -isnot [string] -and $null -ne $manifestItem.crop
    $cropLeft = 0
    $cropTop = 0
    $cropWidth = $source.Width
    $cropHeight = $source.Height
    $outputPath = Join-Path $OutputDirectory ('api-{0:D3}.jpg' -f $index)
    try {
        $workingImage = $source
        if ($hasCrop) {
            $cropWidth = [Math]::Min($source.Width, [Math]::Max(1, [int]$manifestItem.crop.width))
            $cropHeight = [Math]::Min($source.Height, [Math]::Max(1, [int]$manifestItem.crop.height))
            $cropLeft = [Math]::Max(0, [Math]::Min($source.Width - $cropWidth,
                [int][Math]::Round([double]$manifestItem.crop.centerX - $cropWidth / 2)))
            $cropTop = [Math]::Max(0, [Math]::Min($source.Height - $cropHeight,
                [int][Math]::Round([double]$manifestItem.crop.centerY - $cropHeight / 2)))
            $cropped = New-Object System.Drawing.Bitmap($cropWidth, $cropHeight, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
            $cropGraphics = [System.Drawing.Graphics]::FromImage($cropped)
            try {
                $destination = New-Object System.Drawing.Rectangle(0, 0, $cropWidth, $cropHeight)
                $sourceRectangle = New-Object System.Drawing.Rectangle($cropLeft, $cropTop, $cropWidth, $cropHeight)
                $cropGraphics.DrawImage($source, $destination, $sourceRectangle, [System.Drawing.GraphicsUnit]::Pixel)
            } finally {
                $cropGraphics.Dispose()
            }
            $workingImage = $cropped
        }
        $scale = [Math]::Min(1.0, [Math]::Min($MaxWidth / $workingImage.Width, $MaxHeight / $workingImage.Height))
        $width = [Math]::Max(1, [int][Math]::Round($workingImage.Width * $scale))
        $height = [Math]::Max(1, [int][Math]::Round($workingImage.Height * $scale))
        $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Black)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($workingImage, 0, 0, $width, $height)
            } finally {
                $graphics.Dispose()
            }
            # 局部 CAD 证据强制使用最高允许质量，避免一像素细线被普通概览压缩抹平。
            $effectiveJpegQuality = $JpegQuality
            if ($hasCrop) { $effectiveJpegQuality = 95 }
            $qualityEncoder = [System.Drawing.Imaging.Encoder]::Quality
            $parameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
            try {
                $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter($qualityEncoder, [long]$effectiveJpegQuality)
                $bitmap.Save($outputPath, $jpegCodec, $parameters)
            } finally {
                $parameters.Dispose()
            }
        } finally {
            $bitmap.Dispose()
        }
        if (-not (Test-Path -LiteralPath $outputPath)) {
            $directoryFiles = (Get-ChildItem -LiteralPath $OutputDirectory -File | Select-Object -ExpandProperty Name) -join ','
            throw "Screenshot encoder did not create $outputPath (hasCrop=$hasCrop; files=$directoryFiles)"
        }
    } finally {
        if ($null -ne $cropped) { $cropped.Dispose() }
        $source.Dispose()
    }
    $results += [pscustomobject]@{
        source = $sourcePath
        path = $outputPath
        bytes = (Get-Item -LiteralPath $outputPath).Length
        sourceWidth = $sourceWidth
        sourceHeight = $sourceHeight
        cropLeft = $cropLeft
        cropTop = $cropTop
        cropWidth = $cropWidth
        cropHeight = $cropHeight
        outputWidth = $width
        outputHeight = $height
        scale = $scale
        lossless = $false
        jpegQuality = $effectiveJpegQuality
    }
}

ConvertTo-Json -InputObject @($results) -Compress
