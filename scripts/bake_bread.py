"""
Blender headless script — generates a realistic bread stack on a cutting board.
Run with: blender --background --python bake_bread.py

Outputs: public/bread.glb  (geometry only, flat-color materials)
Three.js applies procedural textures at runtime.
"""

import bpy
import bmesh
import math
import random
import os

random.seed(42)

# ── Cleanup ──────────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)


# ── Helper: simple flat-color material ───────────────────────────────────

def flat_material(name, color):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Roughness'].default_value = 0.85
    return mat


# ── Helper: create a bread-slice shape ───────────────────────────────────

def make_bread_slice(name, width=1.1, depth=0.85, height=0.09, seed=0):
    rng = random.Random(seed)

    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name

    # Scale to bread-slice proportions
    obj.scale = (width / 2, depth / 2, height / 2)
    bpy.ops.object.transform_apply(scale=True)

    # Bevel edges for rounded bread shape
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.bevel(offset=0.018, segments=4, affect='EDGES')

    bm = bmesh.from_edit_mesh(obj.data)
    bm.verts.ensure_lookup_table()

    # Organic deformation — slight random displacement
    for v in bm.verts:
        v.co.x += rng.uniform(-0.006, 0.006)
        v.co.y += rng.uniform(-0.006, 0.006)
        v.co.z += rng.uniform(-0.002, 0.002)

    bmesh.update_edit_mesh(obj.data)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Subdivision surface for smooth rounded edges
    subsurf = obj.modifiers.new(name='Subsurf', type='SUBSURF')
    subsurf.levels = 2
    subsurf.render_levels = 2
    bpy.ops.object.modifier_apply(modifier='Subsurf')

    bpy.ops.object.shade_smooth()

    return obj


# ── Create materials ─────────────────────────────────────────────────────

crust_mat = flat_material('BreadCrust', (0.69, 0.41, 0.16))    # golden-brown
crumb_mat = flat_material('BreadCrumb', (0.83, 0.66, 0.33))    # cream-gold
wood_mat = flat_material('WoodBoard', (0.08, 0.035, 0.012))     # dark wood
crumb_particle_mat = flat_material('CrumbParticle', (0.55, 0.32, 0.12))


# ── Cutting board ────────────────────────────────────────────────────────

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.035))
board = bpy.context.active_object
board.name = 'CuttingBoard'
board.scale = (0.85, 0.675, 0.03)
bpy.ops.object.transform_apply(scale=True)

# Bevel board edges
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.bevel(offset=0.012, segments=3, affect='EDGES')
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.shade_smooth()
board.data.materials.append(wood_mat)


# ── Bread slices ─────────────────────────────────────────────────────────

slice_objects = []
for i in range(5):
    base_z = 0.07 + i * 0.095
    width = 1.08 + random.uniform(-0.03, 0.03)
    depth = 0.84 + random.uniform(-0.02, 0.02)
    height = 0.088 + random.uniform(-0.005, 0.005)

    s = make_bread_slice(f'BreadSlice_{i}', width, depth, height, seed=i * 100)
    s.location = (
        random.uniform(-0.006, 0.006),
        random.uniform(-0.006, 0.006),
        base_z,
    )
    s.rotation_euler = (
        random.uniform(-0.008, 0.008),
        random.uniform(-0.008, 0.008),
        random.uniform(-0.02, 0.02),
    )

    # Two materials: crumb (index 0) for top/bottom, crust (index 1) for sides
    s.data.materials.append(crumb_mat)
    s.data.materials.append(crust_mat)

    # Assign by face normal
    bpy.context.view_layer.objects.active = s
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(s.data)
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        if abs(f.normal.z) > 0.45:
            f.material_index = 0  # crumb (top/bottom)
        else:
            f.material_index = 1  # crust (sides)
    bmesh.update_edit_mesh(s.data)
    bpy.ops.object.mode_set(mode='OBJECT')

    slice_objects.append(s)


# ── Crumbs scattered on board ────────────────────────────────────────────

for i in range(30):
    size = random.uniform(0.004, 0.014)
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=size, segments=6, ring_count=4,
        location=(
            random.uniform(-0.7, 0.7),
            random.uniform(-0.55, 0.55),
            0.012 + random.uniform(0, 0.005),
        ),
    )
    c = bpy.context.active_object
    c.name = f'Crumb_{i}'
    c.rotation_euler = (
        random.uniform(0, math.pi * 2),
        random.uniform(0, math.pi * 2),
        random.uniform(0, math.pi * 2),
    )
    c.scale = (
        random.uniform(0.6, 1.4),
        random.uniform(0.6, 1.4),
        random.uniform(0.4, 1.0),
    )
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.shade_smooth()
    c.data.materials.append(crumb_particle_mat)


# ── UV unwrap all objects ────────────────────────────────────────────────

for obj in bpy.data.objects:
    if obj.type != 'MESH':
        continue
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=66, island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')


# ── Export as GLB ────────────────────────────────────────────────────────

script_dir = os.path.dirname(os.path.abspath(__file__))
project_dir = os.path.dirname(script_dir)
output_path = os.path.join(project_dir, 'public', 'bread.glb')

bpy.ops.object.select_all(action='SELECT')

bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_materials='EXPORT',
    export_cameras=False,
    export_lights=False,
)

file_size = os.path.getsize(output_path)
print(f"\n✓ Exported bread model to {output_path}")
print(f"  File size: {file_size / 1024:.1f} KB")
print(f"  Objects: {len(bpy.data.objects)} (5 slices + board + 30 crumbs)")
