-- max_fixture.ms — build the shared hardsurface fixture scene (deterministic).
-- Called after resetMaxFile; defines fn buildFixture().

fn buildFixture = (
    -- modifier targets
    local b = box name:"B1" length:20 width:20 height:20 pos:[0,0,0] \
        lengthsegs:2 widthsegs:2 heightsegs:2
    local s = sphere name:"S1" radius:10 segs:16 pos:[50,0,0]
    local c = cylinder name:"C1" radius:5 height:30 sides:18 heightsegs:3 pos:[-50,0,0]
    -- splines for extrude/lathe/loft/sweep
    local circ = circle name:"SP_CIRCLE" radius:10 pos:[0,50,0]
    local prof = splineShape name:"SP_PROFILE" pos:[0,-50,0]
    addNewSpline prof
    addKnot prof 1 #corner #line [0,-50,0]
    addKnot prof 1 #corner #line [15,-50,0]
    addKnot prof 1 #corner #line [15,-50,25]
    updateShape prof
    -- editable poly target with a known selection
    local pb = box name:"P1" length:20 width:20 height:20 pos:[0,0,50] \
        lengthsegs:1 widthsegs:1 heightsegs:1
    convertToPoly pb
    -- select the top face (face 2 of a default box-as-poly is +Z in 3ds Max
    -- box topology: faces 1..6 = -Z,+Z,-Y,+Y,-X,+X)
    polyop.setFaceSelection pb #{2}
    -- free transform target
    local t = box name:"T1" length:8 width:8 height:8 pos:[80,80,0]
    ok
)
