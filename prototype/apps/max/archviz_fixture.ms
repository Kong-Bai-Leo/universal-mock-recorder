-- archviz_fixture.ms -- shared architectural-visualization fixture scene.
-- Derived from scripts/max/max_fixture.ms (shared file left untouched).
-- Called after resetMaxFile; defines fn buildFixture().
--
-- Scene (all deterministic, world units):
--   WALLS_SP   closed 6-knot wall outline: 200 x 140 room with one notch,
--              on the world origin at z=0 (the "floor plan").
--   FLOOR      plane 200 x 140, 2x2 segs, z=0.
--   COLUMN_SP  circle r=12 inside the room -- column / ring-molding path.
--   PROFILE_SP open 3-knot L profile -- lathe axis + custom sweep section.
--   WALL_BLK   solid wall segment box, south of the room, a clean boolean
--              operand with closed-form vertex math.
--   CUTTER     opening box; it pierces BOTH the room's south wall (once the
--              plan is extruded) and WALL_BLK, so one cutter serves the
--              "door/window opening" story and the closed-form boolean math.
--
-- Wall-plan knots (CCW, closed):
--   (-100,-70) (100,-70) (100,70) (20,70) (20,20) (-100,20)

fn buildFixture = (
    -- 1. the floor plan: closed wall outline spline
    local ws = splineShape name:"WALLS_SP" pos:[0,0,0]
    addNewSpline ws
    addKnot ws 1 #corner #line [-100,-70,0]
    addKnot ws 1 #corner #line [100,-70,0]
    addKnot ws 1 #corner #line [100,70,0]
    addKnot ws 1 #corner #line [20,70,0]
    addKnot ws 1 #corner #line [20,20,0]
    addKnot ws 1 #corner #line [-100,20,0]
    close ws 1
    updateShape ws

    -- 2. floor slab
    local fl = plane name:"FLOOR" length:140 width:200 lengthsegs:2 widthsegs:2 pos:[0,0,0]

    -- 3. column / ring-molding path
    local cs = circle name:"COLUMN_SP" radius:12 pos:[60,-25,0]

    -- 4. open L molding profile (lathe / custom sweep section)
    local pr = splineShape name:"PROFILE_SP" pos:[160,120,0]
    addNewSpline pr
    addKnot pr 1 #corner #line [160,120,0]
    addKnot pr 1 #corner #line [176,120,0]
    addKnot pr 1 #corner #line [176,120,26]
    updateShape pr

    -- 5. solid wall segment (boolean operand A)
    local wb = box name:"WALL_BLK" length:20 width:200 height:100 pos:[0,-140,0] \
        lengthsegs:1 widthsegs:1 heightsegs:1

    -- 6. opening cutter (boolean operand B); pierces WALL_BLK in y and the
    --    room's south wall in y, sits at z 30..80 in both.
    local cu = box name:"CUTTER" length:110 width:36 height:50 pos:[-40,-105,30] \
        lengthsegs:1 widthsegs:1 heightsegs:1
    ok
)
