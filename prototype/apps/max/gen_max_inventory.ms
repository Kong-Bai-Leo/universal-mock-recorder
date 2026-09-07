-- S0 inventory for 3ds Max: reflect creatable classes, modifiers, and the
-- main menu tree into JSON. Counterpart of gen_acad_inventory.py.
resetMaxFile #noPrompt

fn jstr s = (
    local r = ""
    for i = 1 to s.count do (
        local ch = s[i]
        if ch == "\"" then r += "\\\""
        else if ch == "\\" then r += "\\\\"
        else r += ch
    )
    r
)

out = StringStream ""
format "{" to:out

-- creatable object classes by superclass
supers = #(#geometry, #shape, #light, #camera, #helper, #spacewarp)
superVals = #(GeometryClass, shape, light, camera, helper, SpacewarpObject)
for si = 1 to supers.count do (
    format "\"%\":[" (supers[si] as string) to:out
    local first = true
    for c in superVals[si].classes do (
        if c.creatable then (
            if not first then format "," to:out
            first = false
            format "\"%\"" (jstr (c as string)) to:out
        )
    )
    format "]," to:out
)

-- modifiers
format "\"modifiers\":[" to:out
first = true
for c in modifier.classes do (
    if c.creatable then (
        if not first then format "," to:out
        first = false
        format "\"%\"" (jstr (c as string)) to:out
    )
)
format "]," to:out

-- materials + textures
format "\"materials\":[" to:out
first = true
for c in material.classes do (
    if c.creatable then (
        if not first then format "," to:out
        first = false
        format "\"%\"" (jstr (c as string)) to:out
    )
)
format "]," to:out

-- macroScripts (UI buttons); macros.list writes to a CharStream
ms = StringStream ""
macros.list to:ms
seek ms 0
format "\"macroscripts\":[" to:out
first = true
while not eof ms do (
    local ln = readLine ms
    local toks = filterString ln " \t\""
    if toks.count >= 2 and toks[1] == "macroScript" then (
        if not first then format "," to:out
        first = false
        format "{\"name\":\"%\"}" (jstr toks[2]) to:out
    )
)
format "]," to:out

-- main menu tree: menuMan is GUI-only; headless runs record null
format "\"main_menu\":null" to:out

format "}" to:out

fo = createFile "C:/agenthle_secure/max3d/inventory_raw.json"
format "%" (out as string) to:fo
close fo
quitMax #noPrompt
