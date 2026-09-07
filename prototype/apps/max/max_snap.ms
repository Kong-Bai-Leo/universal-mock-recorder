-- max_snap.ms — canonical scene snapshot to JSON (oracle side).
-- Include via: fileIn "max_snap.ms" ; then call snapSceneToFile "path.json"
-- Covers: per-object class/transform/mesh (verts+faces)/modifier stack with
-- parameters/material assignment; scene-level counts.

global _snap_prec = 6

fn _jnum v = (
    if v == undefined then return "null"
    local x = v as float
    if (abs x) < 1e-9 then x = 0.0
    formattedPrint x format:("." + (_snap_prec as string) + "g")
)

fn _jstr s = (
    local r = ""
    for i = 1 to s.count do (
        local ch = s[i]
        if ch == "\"" then r += "\\\""
        else if ch == "\\" then r += "\\\\"
        else if ch == "\n" then r += "\\n"
        else r += ch
    )
    "\"" + r + "\""
)

fn _jp3 p = ("[" + (_jnum p.x) + "," + (_jnum p.y) + "," + (_jnum p.z) + "]")

fn _jquat q = ("[" + (_jnum q.x) + "," + (_jnum q.y) + "," + (_jnum q.z) + "," + (_jnum q.w) + "]")

-- serialize one parameter value
fn _jval v = (
    case (classOf v) of (
        Integer: (v as string)
        Float: (_jnum v)
        BooleanClass: (if v then "true" else "false")
        String: (_jstr v)
        Point3: (_jp3 v)
        Name: (_jstr (v as string))
        default: (_jstr (v as string))
    )
)

-- properties of a modifier / base object
fn _jprops obj = (
    local out = StringStream ""
    format "{" to:out
    local first = true
    local names = getPropNames obj
    for pn in names do (
        local ok = true
        local v = undefined
        try ( v = getProperty obj pn ) catch ( ok = false )
        if ok and v != undefined and (superClassOf v != node) then (
            local cls = classOf v
            if cls == Integer or cls == Float or cls == BooleanClass or \
               cls == String or cls == Point3 or cls == Name then (
                if not first then format "," to:out
                first = false
                format "%:%" (_jstr (pn as string)) (_jval v) to:out
            )
        )
    )
    format "}" to:out
    out as string
)

fn _jmesh o = (
    local out = StringStream ""
    local m = undefined
    try ( m = snapshotAsMesh o ) catch ( m = undefined )
    if m == undefined then ( format "null" to:out; return (out as string) )
    format "{\"nv\":%,\"nf\":%,\"verts\":[" m.numVerts m.numFaces to:out
    for i = 1 to m.numVerts do (
        if i > 1 then format "," to:out
        format "%" (_jp3 (getVert m i)) to:out
    )
    format "],\"faces\":[" to:out
    for i = 1 to m.numFaces do (
        if i > 1 then format "," to:out
        local f = getFace m i
        format "[%,%,%]" ((f.x as integer)) ((f.y as integer)) ((f.z as integer)) to:out
    )
    format "]}" to:out
    delete m
    out as string
)

fn snapScene = (
    local out = StringStream ""
    format "{\"objects\":[" to:out
    local objs = for o in objects collect o
    -- stable order by name
    qsort objs (fn cmp a b = (if a.name < b.name then -1 else if a.name > b.name then 1 else 0))
    local first = true
    for o in objs do (
        if not first then format "," to:out
        first = false
        format "{\"name\":%,\"class\":%," (_jstr o.name) (_jstr (classOf o as string)) to:out
        format "\"pos\":%,\"rot\":%,\"scale\":%," (_jp3 o.pos) (_jquat o.rotation) (_jp3 o.scale) to:out
        local mtl = "null"
        if o.material != undefined then mtl = _jstr (classOf o.material as string)
        format "\"material\":%," mtl to:out
        format "\"base_params\":%," (_jprops o.baseObject) to:out
        format "\"modifiers\":[" to:out
        for mi = 1 to o.modifiers.count do (
            if mi > 1 then format "," to:out
            local md = o.modifiers[mi]
            format "{\"class\":%,\"name\":%,\"params\":%}" \
                (_jstr (classOf md as string)) (_jstr md.name) (_jprops md) to:out
        )
        format "]," to:out
        format "\"mesh\":%" (_jmesh o) to:out
        format "}" to:out
    )
    format "],\"counts\":{\"objects\":%}}" objects.count to:out
    out as string
)

fn snapSceneToFile fp = (
    local f = createFile fp
    format "%" (snapScene()) to:f
    close f
)
