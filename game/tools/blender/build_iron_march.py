"""Original Iron March library. Blender 4.5+, no add-ons or external assets.

blender --background --factory-startup --python tools/blender/build_iron_march.py
Authoring helpers accept the game's metre units: +Y up, +Z forward.
Outputs one vertex-coloured GLB and an editable, arranged .blend library.
"""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "assets" / "blender"
SOURCE = ROOT / "assets" / "source"
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)


def linear(v):
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4


def mat(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*[linear(int(color[i:i+2], 16) / 255) for i in (0, 2, 4)], 1)
    return m


BONE = mat("Ivory bone", "e9e7d9")
SHADE = mat("Old bone", "a0a79d")
DARK = mat("Recess and soot", "263138")
IRON = mat("Forged iron", "536775")
STEEL = mat("Edge steel", "a7bac3")
BRASS = mat("Brass fittings", "d7a750")
RUST = mat("Oxide armor", "9f5340")
WOOD = mat("Walnut", "70513d")
CLOTH = mat("Torn teal cloth", "354d50")
STONE = mat("Limestone", "b4b7b1")
PLASTER = mat("Chalk plaster", "e3daca")
ROOF = mat("Clay tiles", "a06448")
SLATE = mat("Blue slate", "536b7d")
GREEN = mat("Reactor jade", "68e6a5")
FIRE = mat("Fire tip", "ef6525")
HOT = mat("Fire core", "ffe6a0")
WHITE = mat("Effect white", "ffffff")

parts = []
library = {}


def xyz(p):
    return Vector((p[0], -p[2], p[1]))


def finish(o, material):
    o.data.materials.append(material)
    parts.append(o)
    return o


def box(loc, dims, material, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(loc))
    o = bpy.context.object
    o.dimensions = (dims[0], dims[2], dims[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new("Small manufactured edge", "BEVEL")
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o, material)


def ball(loc, dims, material, segments=10, rings=6):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=xyz(loc))
    o = bpy.context.object
    o.scale = (dims[0], dims[2], dims[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, material)


def rod(a, b, radius, material, vertices=8, end_radius=None):
    av, bv = xyz(a), xyz(b)
    delta = bv-av
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius,
        radius2=radius if end_radius is None else end_radius, depth=delta.length,
        location=(av+bv)/2)
    o = bpy.context.object
    o.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
    return finish(o, material)


def mesh(vertices, faces, material):
    unique = []
    seen = set()
    for face in faces:
        key = tuple(sorted(face))
        if key not in seen:
            unique.append(face)
            seen.add(key)
    data = bpy.data.meshes.new("Authored surface")
    data.from_pydata([xyz(v) for v in vertices], [], unique)
    data.update()
    o = bpy.data.objects.new("Surface", data)
    bpy.context.collection.objects.link(o)
    if len(unique) != len(faces):
        # Thin closed slabs, not coincident opposite polygons (invalid GLB mesh).
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new("Surface thickness", "SOLIDIFY")
        mod.thickness = .012
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o, material)


def hoop(loc, rx, rz, tube, material, count=12):
    for i in range(count):
        a, b = math.tau*i/count, math.tau*(i+1)/count
        rod((loc[0]+rx*math.cos(a), loc[1], loc[2]+rz*math.sin(a)),
            (loc[0]+rx*math.cos(b), loc[1], loc[2]+rz*math.sin(b)), tube, material, 5)


def asset(name):
    """Bake component colors and transforms into a single draw-compatible mesh."""
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    o = bpy.context.object
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.name = name
    color = o.data.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    for face in o.data.polygons:
        rgba = o.data.materials[face.material_index].diffuse_color
        for loop in face.loop_indices:
            color.data[loop].color = rgba
    o.data.materials.clear()
    o.data.materials.append(vertex_material)
    for face in o.data.polygons:
        face.material_index = 0
        face.use_smooth = False
    mod = o.modifiers.new("Export triangles", "TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=mod.name)
    assert not o.data.validate(clean_customdata=False), "Invalid mesh: "+name
    o.data.update()
    library[name] = o
    parts.clear()


vertex_material = bpy.data.materials.new("Iron March vertex palette")
vertex_material.use_nodes = True
bsdf = vertex_material.node_tree.nodes.get("Principled BSDF")
bsdf.inputs["Roughness"].default_value = .78
attribute = vertex_material.node_tree.nodes.new("ShaderNodeVertexColor")
attribute.layer_name = "Color"
vertex_material.node_tree.links.new(attribute.outputs["Color"], bsdf.inputs["Base Color"])


def house(kind):
    roof_material = ROOF if kind == "cottage" else SLATE if kind == "town" else IRON
    box((0, .1, 0), (5.1, .2, 4.35), STONE, .035)
    # Deep entry is deliberately open; columns/lintel, not a solid front wall.
    box((-1.72, 1.48, 1.94), (1.5, 2.75, .28), PLASTER)
    box((1.72, 1.48, 1.94), (1.5, 2.75, .28), PLASTER)
    box((0, 2.63, 1.94), (2, .48, .28), PLASTER)
    box((0, 1.48, -1.94), (4.95, 2.75, .28), PLASTER)
    for s in [-1, 1]:
        box((s*2.34, 1.48, 0), (.28, 2.75, 3.9), PLASTER)
        box((s*2.48, .4, 0), (.12, .4, 4.05), STONE)
        for z in [-1.84, 1.84]:
            box((s*2.4, 1.5, z), (.16, 2.8, .22), WOOD if kind == "cottage" else STONE)
        # Side windows have dark recesses, lintels, divided glass and shutters.
        for z in [-.95, .95]:
            box((s*2.5, 1.85, z), (.06, .78, .8), DARK)
            box((s*2.55, 1.82, z), (.055, .64, .06), BRASS)
            box((s*2.56, 1.82, z), (.055, .055, .78), BRASS)
            for yy in [1.4, 2.29]: box((s*2.57, yy, z), (.13, .12, 1.04), STONE)
    box((0, 1.25, .9), (1.8, 2.35, .12), DARK)
    box((0, .18, 2.12), (1.85, .16, .34), STONE)
    for s in [-1, 1]:
        box((s*.93, 1.3, 2.12), (.16, 2.35, .22), WOOD)
    box((0, 2.48, 2.12), (2.08, .18, .25), WOOD)
    # Closed triangular gables support the roof instead of floating slabs.
    for z in [-2.0, 2.0]:
        mesh([(-2.5, 2.85, z), (2.5, 2.85, z), (0, 4.02, z)], [(0,1,2), (2,1,0)], PLASTER)
    for s in [-1, 1]:
        mesh([(0,4.09,-2.22),(s*2.64,2.91,-2.22),(s*2.64,2.91,2.22),(0,4.09,2.22)],
             [(0,1,2,3),(3,2,1,0)], roof_material)
        # Broad tile courses read in gameplay; no tiny individual-tile meshes.
        for band in range(1, 5):
            x = s*2.64*band/5
            y = 4.1-1.18*band/5
            rod((x,y,-2.2),(x,y,2.2),.035, roof_material, 5)
        rod((s*2.64,2.93,-2.23),(s*2.64,2.93,2.23),.07, WOOD, 6)
    rod((0,4.12,-2.25),(0,4.12,2.25),.10, roof_material, 8)
    if kind == "foundry":
        box((-1.4,3.1,-.95),(.7,3.7,.7), RUST, .04)
        box((-1.4,4.95,-.95),(.87,.16,.87), DARK)
        for z in [-1.75,-.9,0,.9,1.75]: box((2.55,1.1,z),(.14,1.8,.14), IRON)
        box((0,2.71,2.22),(1.3,.34,.10), IRON, .025)
        box((0,2.72,2.29),(.14,.24,.03), BRASS)
    elif kind == "town":
        box((1.46,3.7,-.9),(.6,1.9,.64), STONE, .04)
        box((1.46,4.7,-.9),(.8,.14,.83), DARK)
        # A little dormer, carved into the roof silhouette.
        box((1.55,3.65,.7),(.95,.7,.7), PLASTER)
        box((1.58,3.65,1.08),(.6,.43,.055), DARK)
        box((1.55,4.03,.7),(1.13,.12,.92), SLATE, .025)
    else:
        box((-1.4,3.65,-1.1),(.64,1.65,.68), RUST, .035)
        box((-1.4,4.5,-1.1),(.8,.13,.84), STONE)
        for s in [-1,1]:
            rod((s*1.05,2.84,2.06),(s*2.35,.4,2.06),.05,WOOD,5)
        box((-1.65,.8,2.17),(.7,.13,.16), WOOD)
    asset("house_"+kind)


def skull(scale=1, armored=False, golem=False):
    # Faceted cranium and recessed sockets retain a white silhouette.
    ball((0,.18,.015),(.14*scale,.18*scale,.14*scale), BONE, 12, 7)
    for s in [-1,1]:
        ball((s*.062*scale,.18,.139*scale),(.054*scale,.055*scale,.023), DARK, 8, 5)
        rod((s*.027*scale,.244,s*.01+.13*scale),(s*.116*scale,.246,.11*scale),.018,BONE,6)
        ball((s*.1*scale,.1,.085*scale),(.05,.045,.047),SHADE,8,4)
    mesh([(-.018,.15,.161*scale),(.019,.15,.161*scale),(0,.095,.168*scale)],[(0,1,2),(2,1,0)],DARK)
    box((0,.018,.06),(.20*scale,.05,.14*scale),SHADE,.008)
    for x in [-.066,-.022,.022,.066]: box((x,.055,.143*scale),(.027,.048,.034),BONE)
    if armored:
        ball((0,.31,-.01),(.18*scale,.07,.15*scale),IRON,10,4)
        for s in [-1,1]: rod((s*.14,.29,0),(s*.22,.48,-.03),.055,BRASS,6,end_radius=.007)
    if golem:
        for s in [-1,1]: box((s*.055,.18,.171),(.054,.033,.018),GREEN)


def enemy(kind):
    golem = kind == "golem"
    armored = kind != "minion"
    bone = STONE if golem else BONE
    width = 1.8 if golem else 1
    box((0,0,0),(.29*width,.15*width,.19*width),bone,.025)
    for s in [-1,1]: ball((s*.125*width,.02,0),(.09*width,.08,.07),SHADE,8,4)
    mesh([(-.16*width,-.07,-.10),(.16*width,-.07,-.10),(.13*width,-.23,-.15),(-.10*width,-.18,-.18)],[(0,1,2,3),(3,2,1,0)],CLOTH)
    asset(kind+"_pelvis")
    if golem:
        box((0,.27,0),(.74,.57,.46),IRON,.075)
        for s in [-1,1]:
            box((s*.23,.35,.22),(.27,.42,.15),STONE,.035)
            ball((s*.42,.49,0),(.24,.17,.28),STONE,8,4)
        box((0,.31,.24),(.08,.33,.04),GREEN)
    else:
        rod((0,0,-.055),(0,.44,-.055),.033,SHADE,6)
        for y in [.1,.19,.28]: hoop((0,y,0),.15,.105,.021,BONE,10)
        rod((0,.1,.105),(0,.35,.09),.024,BONE,5)
        rod((-.2,.42,0),(.2,.42,0),.033,BONE,6)
        mesh([(-.17,.4,-.10),(.17,.4,-.10),(.13,.03,-.2),(-.08,.1,-.21),(-.15,-.04,-.18)],[(0,1,2,3,4),(4,3,2,1,0)],CLOTH)
        if armored:
            box((0,.26,.1),(.33,.32,.075),RUST,.028)
            for s in [-1,1]: rod((s*.105,.12,.16),(s*.105,.38,.16),.018,BRASS,5)
    asset(kind+"_torso")
    skull(1.25 if golem else 1, armored, golem)
    asset(kind+"_head")
    for part, length, radius in [("upperArm",.36 if golem else .30,.105 if golem else .042),
                                 ("forearm",.34 if golem else .28,.10 if golem else .037),
                                 ("thigh",.4 if golem else .44,.11 if golem else .049),
                                 ("shin",.42 if golem else .50,.10 if golem else .037)]:
        ball((0,-.015,0),(radius*1.35,radius*1.15,radius*1.35),bone,8,4)
        if not golem and part in ("forearm","shin"):
            for s in [-1,1]: rod((s*.021,-.05,0),(s*.018,-length+.05,.005),radius*.6,bone,6)
        else: rod((0,-.04,0),(0,-length+.05,0),radius,bone,8,end_radius=radius*.73)
        ankle_clearance = max(.055, radius) if part == "shin" else .055
        ball((0,-length+ankle_clearance,0),(radius*1.2,radius,radius*1.1),SHADE,8,4)
        if armored:
            box((0,-length*.4,.04),(.15 if not golem else .27,length*.47,.10 if not golem else .23),RUST if not golem else STONE,.025)
        if part == "forearm":
            box((0,-length-.03,.015),(.105*width,.10,.09),bone,.01)
            for s in [-1,0,1]: rod((s*.028,-length-.04,.015),(s*.032,-length-.105,.07),.011*width,bone,5)
        if part == "shin":
            box((0,-length+.035,.07),(.15*width,.07,.27),bone,.018)
            for s in [-1,0,1]: box((s*.044,-length+.025,.214),(.033,.05,.065),bone,.005)
        asset(kind+"_"+part)


def gun(kind):
    box((0,-.075,-.05),(.085,.19,.12),WOOD,.018)
    box((0,.02,.04),(.14,.14,.28),IRON,.022)
    box((0,.025,-.25),(.10,.12,.25),WOOD,.02)
    # Open guard and a bright receiver plate reveal the grip and moving parts.
    for s in [-1,1]: box((s*.073,.035,.04),(.025,.085,.16),BRASS,.007)
    rod((0,-.14,.01),(0,-.14,.13),.012,BRASS,6)
    rod((0,-.14,.13),(0,-.03,.13),.012,BRASS,6)
    tip = {"shotgun":.58,"carbine":.76,"rifle":.9,"flamer":.88,"arc":.8,"launcher":.9}[kind]
    if kind == "shotgun":
        for s in [-1,1]:
            rod((s*.036,.032,.16),(s*.036,.032,tip),.033,STEEL,10)
            rod((s*.036,.032,tip),(s*.036,.032,tip+.009),.023,DARK,10)
        box((0,-.008,.3),(.13,.075,.20),WOOD,.013)
    elif kind in ("carbine","rifle"):
        rod((0,.035,.15),(0,.035,tip),.038,STEEL,10)
        rod((0,.035,tip-.06),(0,.035,tip),.055,IRON,10)
        rod((0,.035,tip),(0,.035,tip+.006),.025,DARK,10)
        if kind == "rifle":
            rod((0,.15,-.02),(0,.15,.3),.045,DARK,10)
            rod((0,.15,.3),(0,.15,.32),.048,GREEN,10)
        else:
            rod((-.12,-.06,.12),(.12,-.06,.12),.11,BRASS,10)
            box((0,.13,.35),(.045,.07,.05),DARK,.008)
    elif kind == "flamer":
        rod((0,.02,-.32),(0,.02,-.07),.13,BRASS,10)
        rod((0,.02,.15),(0,.02,.72),.065,IRON,10)
        rod((0,.02,.70),(0,.02,tip),.12,STEEL,10,end_radius=.085)
        rod((0,.02,tip),(0,.02,tip+.01),.063,DARK,10)
        rod((0,-.05,.68),(0,-.05,.85),.017,BRASS,6)
    elif kind == "arc":
        rod((0,.04,.15),(0,.04,.7),.055,DARK,10)
        for z in [.24,.36,.48]: rod((0,.04,z),(0,.04,z+.03),.1,BRASS,12)
        for s in [-1,1]: rod((s*.09,.04,.55),(s*.09,.04,tip),.024,STEEL,8)
        ball((0,.04,.73),(.055,.055,.06),GREEN,10,5)
    else:
        rod((0,.04,.13),(0,.04,tip),.115,IRON,12)
        for z in [.29,.48,.68]: rod((0,.04,z),(0,.04,z+.035),.145,BRASS,12)
        rod((0,.04,tip-.035),(0,.04,tip+.02),.16,STEEL,12)
        rod((0,.04,tip+.021),(0,.04,tip+.025),.105,DARK,12)
    asset("gun_"+kind)


def effects():
    # Closed pointed flash along +Z, not a square plane.
    mesh([(0,0,1),(-.22,0,.24),(0,.16,.15),(.22,0,.24),(0,-.16,.15),(0,0,0)],
         [(0,1,2),(0,2,3),(0,3,4),(0,4,1),(5,2,1),(5,3,2),(5,4,3),(5,1,4)],WHITE)
    asset("fx_flash")
    # Bent, tapered tongues; three rings avoid the old straight pyramid outline.
    # White palette is colored by the pooled instance at runtime.
    for x,z,h in [(-.18,-.05,.72),(.12,.03,1),(0,.18,.58)]:
        points = []
        for dx, y, r in [(0,0,.16),(-.035,h*.35,.13),(.055,h*.68,.068)]:
            points.extend([(x+dx-r,y,z-r*.8),(x+dx+r,y,z-r*.8),
                           (x+dx+r,y,z+r*.8),(x+dx-r,y,z+r*.8)])
        points.append((x+.16,h,z-.06))
        faces = [(3,2,1,0)]
        for ring in range(2):
            for side in range(4):
                a = ring*4+side; b = ring*4+(side+1)%4
                faces.append((a,b,b+4,a+4))
        faces.extend([(8+s,8+(s+1)%4,12) for s in range(4)])
        mesh(points,faces,WHITE)
    asset("fx_flame")
    for i in range(7):
        a = math.tau*i/7
        rod((0,0,0),(.52*math.sin(a),.12+(i%3)*.06,.52*math.cos(a)),.07,WHITE,4,end_radius=0)
    asset("fx_impact")
    for x,y,z,r in [(-.2,.15,0,.3),(.15,.25,.04,.36),(0,.53,.03,.27)]:
        ball((x,y,z),(r,r*.78,r),WHITE,8,4)
    asset("fx_smoke")


for kind in ["cottage","town","foundry"]: house(kind)
for kind in ["minion","warrior","golem"]: enemy(kind)
for kind in ["shotgun","carbine","rifle","flamer","arc","launcher"]: gun(kind)
effects()
assert len(library) == 34
bpy.ops.object.select_all(action="DESELECT")
for o in library.values(): o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/"iron-march.glb"), export_format="GLB",
    use_selection=True, export_yup=True, export_animations=False, export_cameras=False,
    export_lights=False, export_materials="EXPORT", export_attributes=True)

report = {"version":1,"generator":"Blender "+bpy.app.version_string,
          "license":"Original game artwork; no third-party source assets",
          "bytes":(OUT/"iron-march.glb").stat().st_size,
          "meshes":{name:{"triangles":len(o.data.polygons)} for name,o in library.items()}}
(OUT/"catalog.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")

# Source library: mesh-local runtime pieces are retained, with separate arranged
# full-model previews for an artist opening the .blend file.
source = bpy.data.collections.new("Runtime meshes - local origins")
bpy.context.scene.collection.children.link(source)
preview = bpy.data.collections.new("Assembled previews")
bpy.context.scene.collection.children.link(preview)
for o in library.values():
    for c in list(o.users_collection): c.objects.unlink(o)
    source.objects.link(o)
source.hide_viewport = True
source.hide_render = True


def instance(name, loc, scale=1):
    o = bpy.data.objects.new(name+" preview",library[name].data)
    preview.objects.link(o)
    o.location=xyz(loc)
    o.scale=(scale,scale,scale)


for i,k in enumerate(["cottage","town","foundry"]): instance("house_"+k,((i-1)*7,0,-7))
for i,k in enumerate(["minion","warrior","golem"]):
    g=k=="golem"
    hip=.82 if g else .94
    spine=.06 if g else .05
    torso=hip+spine
    x=(i-1)*4
    instance(k+"_pelvis",(x,hip,0))
    instance(k+"_torso",(x,torso,0))
    instance(k+"_head",(x,torso+(.56 if g else .48),0))
    for s in [-1,1]:
        arm=torso+(.46 if g else .42)
        ax=x+s*(.44 if g else .2)
        instance(k+"_upperArm",(ax,arm,0))
        instance(k+"_forearm",(ax,arm-(.36 if g else .3),0))
        lx=x+s*(.2 if g else .105)
        instance(k+"_thigh",(lx,hip,0))
        instance(k+"_shin",(lx,hip-(.4 if g else .44),0))
for i,k in enumerate(["shotgun","carbine","rifle","flamer","arc","launcher"]): instance("gun_"+k,((i-2.5)*2,1,4),2)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/"iron-march-library.blend"), compress=True)
print("IRON_MARCH_ASSETS "+json.dumps(report))
