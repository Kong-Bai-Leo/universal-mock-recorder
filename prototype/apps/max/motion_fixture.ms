-- motion_fixture.ms — shared animation fixture scene (deterministic).
-- Called after resetMaxFile; defines fn buildFixture().
--
-- A1      Box    at origin              — primary animation target
-- A2      Sphere at [40,0,0]            — secondary / child / constraint target
-- PATH_SP Circle radius 30 at origin    — path-constraint spline
-- TGT     Point  helper at [0,60,0]     — lookat / position-constraint target

fn buildFixture = (
    animationRange = interval 0 100
    frameRate = 30
    sliderTime = 0

    local a1 = box name:"A1" length:20 width:20 height:20 pos:[0,0,0] \
        lengthsegs:1 widthsegs:1 heightsegs:1
    local a2 = sphere name:"A2" radius:10 segs:8 pos:[40,0,0]
    local sp = circle name:"PATH_SP" radius:30 pos:[0,0,0]
    local tg = point name:"TGT" pos:[0,60,0] size:10 cross:true box:false

    ok
)
