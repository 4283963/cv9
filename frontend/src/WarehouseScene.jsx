import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const SHELF_WIDTH = 2.0
const SHELF_DEPTH = 1.0
const LEVEL_HEIGHT = 1.2
const SLOT_WIDTH = 0.45
const SLOT_DEPTH = 0.45
const SLOT_HEIGHT = 1.0

const LERP_SPEED = 6.0
const ROT_LERP_SPEED = 4.0

export default function WarehouseScene({ warehouse, shelves, agvs }) {
  const mountRef = useRef(null)
  const sceneRef = useRef(null)
  const rendererRef = useRef(null)
  const cameraRef = useRef(null)
  const controlsRef = useRef(null)
  const agvMeshesRef = useRef(new Map())
  const agvStateRef = useRef(new Map())
  const frameIdRef = useRef(null)
  const lastTimeRef = useRef(performance.now())
  const agvsRef = useRef(agvs)

  agvsRef.current = agvs

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const width = mount.clientWidth
    const height = mount.clientHeight

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0f1a)
    scene.fog = new THREE.Fog(0x0a0f1a, 50, 150)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 500)
    const w = warehouse?.width || 30
    const l = warehouse?.length || 25
    camera.position.set(w * 0.9, w * 0.7, l * 1.2)
    camera.lookAt(w / 2, 0, l / 2)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(w / 2, 0, l / 2)
    controls.maxPolarAngle = Math.PI / 2.1
    controls.minDistance = 5
    controls.maxDistance = 100
    controlsRef.current = controls

    const ambient = new THREE.AmbientLight(0xffffff, 0.5)
    scene.add(ambient)

    const hemi = new THREE.HemisphereLight(0x60a5fa, 0x1e293b, 0.3)
    scene.add(hemi)

    const sun = new THREE.DirectionalLight(0xffffff, 0.9)
    sun.position.set(w * 0.6, w * 0.8, l * 0.4)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -w
    sun.shadow.camera.right = w * 2
    sun.shadow.camera.top = l * 2
    sun.shadow.camera.bottom = -l
    sun.shadow.camera.near = 0.5
    sun.shadow.camera.far = 200
    scene.add(sun)

    const fill = new THREE.DirectionalLight(0x3b82f6, 0.2)
    fill.position.set(-w * 0.3, w * 0.4, l * 1.5)
    scene.add(fill)

    createFloor(scene, w, l)
    createWarehouseWalls(scene, w, l, warehouse?.height || 8)
    createGridLines(scene, w, l)

    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate)

      const now = performance.now()
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1)
      lastTimeRef.current = now

      updateAGVAnimations(dt)

      controls.update()
      renderer.render(scene, camera)
    }
    lastTimeRef.current = performance.now()
    animate()

    const onResize = () => {
      if (!mount) return
      const nw = mount.clientWidth
      const nh = mount.clientHeight
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      if (frameIdRef.current) cancelAnimationFrame(frameIdRef.current)
      controls.dispose()
      renderer.dispose()
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement)
      }
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose?.()
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.())
          else obj.material.dispose?.()
        }
      })
    }
  }, [warehouse])

  const updateAGVAnimations = (dt) => {
    const camera = cameraRef.current
    if (!camera) return

    agvStateRef.current.forEach((state, id) => {
      const mesh = agvMeshesRef.current.get(id)
      if (!mesh) return

      const lerpFactor = 1 - Math.exp(-LERP_SPEED * dt)
      mesh.position.x += (state.targetPos.x - mesh.position.x) * lerpFactor
      mesh.position.z += (state.targetPos.z - mesh.position.z) * lerpFactor
      mesh.position.y = state.targetPos.y

      const dx = state.targetPos.x - state.prevPos.x
      const dz = state.targetPos.z - state.prevPos.z
      const moving = Math.sqrt(dx * dx + dz * dz) > 0.02
      if (moving) {
        const targetRot = Math.atan2(dx, dz)
        state.targetRot = targetRot
      }

      const rotLerp = 1 - Math.exp(-ROT_LERP_SPEED * dt)
      let currentRot = mesh.rotation.y
      let targetRot = state.targetRot ?? currentRot
      let diff = targetRot - currentRot
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      mesh.rotation.y += diff * rotLerp

      const wheels = mesh.getObjectByName('wheels')
      if (wheels && moving) {
        const wheelSpeed = 8.0
        wheels.children.forEach((w) => {
          w.rotation.x += wheelSpeed * dt
        })
      }

      const label = mesh.getObjectByName('label')
      if (label) {
        label.lookAt(camera.position)
      }
    })
  }

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !shelves) return

    const shelfGroup = scene.getObjectByName('shelvesGroup')
    if (shelfGroup) {
      shelfGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose?.()
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.())
          else obj.material.dispose?.()
        }
      })
      scene.remove(shelfGroup)
    }

    const group = new THREE.Group()
    group.name = 'shelvesGroup'

    shelves.forEach((shelf) => {
      createShelf(group, shelf)
    })

    scene.add(group)
  }, [shelves])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !agvs) return

    const currentIds = new Set(agvs.map((a) => a.id))

    agvMeshesRef.current.forEach((mesh, id) => {
      if (!currentIds.has(id)) {
        scene.remove(mesh)
        mesh.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose?.()
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.())
            else obj.material.dispose?.()
          }
        })
        agvMeshesRef.current.delete(id)
        agvStateRef.current.delete(id)
      }
    })

    agvs.forEach((agv) => {
      let agvMesh = agvMeshesRef.current.get(agv.id)
      if (!agvMesh) {
        agvMesh = createAGV(agv)
        agvMesh.position.set(agv.position.x, agv.position.y, agv.position.z)
        scene.add(agvMesh)
        agvMeshesRef.current.set(agv.id, agvMesh)

        const initTargetRot = agv.target
          ? Math.atan2(agv.target.x - agv.position.x, agv.target.z - agv.position.z)
          : 0

        agvStateRef.current.set(agv.id, {
          targetPos: { x: agv.position.x, y: agv.position.y, z: agv.position.z },
          prevPos: { x: agv.position.x, y: agv.position.y, z: agv.position.z },
          targetRot: initTargetRot,
        })
      }

      const state = agvStateRef.current.get(agv.id)
      if (state) {
        state.prevPos = { ...state.targetPos }
        state.targetPos = { x: agv.position.x, y: agv.position.y, z: agv.position.z }
      }

      const body = agvMesh.getObjectByName('body')
      if (body) {
        let color = 0x3b82f6
        if (agv.status === 'charging') color = 0xfbbf24
        else if (agv.status === 'idle') color = 0x64748b
        body.material.color.setHex(color)
        body.material.emissive.setHex(color)
        body.material.emissiveIntensity = agv.status === 'working' ? 0.35 : 0.15
      }

      const light = agvMesh.getObjectByName('statusLight')
      if (light) {
        const lightColor = agv.status === 'working' ? 0x22c55e : 0xef4444
        light.material.color.setHex(lightColor)
      }
    })
  }, [agvs])

  return <div ref={mountRef} className="canvas-container" />
}

function createFloor(scene, w, l) {
  const floorGeo = new THREE.PlaneGeometry(w, l)
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.85,
    metalness: 0.1,
  })
  const floor = new THREE.Mesh(floorGeo, floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(w / 2, 0, l / 2)
  floor.receiveShadow = true
  scene.add(floor)

  const laneMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.9,
    metalness: 0.05,
  })
  const laneGeo = new THREE.PlaneGeometry(w, 2.6)
  for (let z = 2.5; z < l - 2; z += 6) {
    const lane = new THREE.Mesh(laneGeo, laneMat)
    lane.rotation.x = -Math.PI / 2
    lane.position.set(w / 2, 0.001, z)
    lane.receiveShadow = true
    scene.add(lane)
  }
}

function createWarehouseWalls(scene, w, l, h) {
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x1e3a5f,
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
    roughness: 1,
  })

  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat)
  back.position.set(w / 2, h / 2, 0)
  scene.add(back)

  const left = new THREE.Mesh(new THREE.PlaneGeometry(l, h), wallMat)
  left.position.set(0, h / 2, l / 2)
  left.rotation.y = Math.PI / 2
  scene.add(left)

  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.6 })

  const edges = [
    [[0, 0, 0], [w, 0, 0]],
    [[w, 0, 0], [w, 0, l]],
    [[w, 0, l], [0, 0, l]],
    [[0, 0, l], [0, 0, 0]],
    [[0, 0, 0], [0, h, 0]],
    [[w, 0, 0], [w, h, 0]],
    [[w, 0, l], [w, h, l]],
    [[0, 0, l], [0, h, l]],
    [[0, h, 0], [w, h, 0]],
    [[w, h, 0], [w, h, l]],
    [[w, h, l], [0, h, l]],
    [[0, h, l], [0, h, 0]],
  ]

  edges.forEach(([from, to]) => {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...from),
      new THREE.Vector3(...to),
    ])
    const line = new THREE.Line(geo, edgeMat)
    scene.add(line)
  })
}

function createGridLines(scene, w, l) {
  const grid = new THREE.GridHelper(Math.max(w, l), Math.max(w, l), 0x1e3a5f, 0x1a2940)
  grid.position.set(w / 2, 0.002, l / 2)
  scene.add(grid)
}

function createShelf(group, shelf) {
  const shelfGroup = new THREE.Group()
  shelfGroup.position.set(shelf.position.x, 0, shelf.position.z)

  const totalWidth = shelf.columns * SLOT_WIDTH + (shelf.columns - 1) * 0.05 + 0.1
  const totalDepth = shelf.rows * SLOT_DEPTH + (shelf.rows - 1) * 0.05 + 0.1
  const totalHeight = shelf.levels * LEVEL_HEIGHT

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    metalness: 0.7,
    roughness: 0.35,
  })
  const poleGeo = new THREE.BoxGeometry(0.08, totalHeight, 0.08)
  const corners = [
    [-totalWidth / 2, -totalDepth / 2],
    [totalWidth / 2, -totalDepth / 2],
    [-totalWidth / 2, totalDepth / 2],
    [totalWidth / 2, totalDepth / 2],
  ]
  corners.forEach(([x, z]) => {
    const pole = new THREE.Mesh(poleGeo, frameMat)
    pole.position.set(x, totalHeight / 2, z)
    pole.castShadow = true
    shelfGroup.add(pole)
  })

  const shelfPlateMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    metalness: 0.5,
    roughness: 0.5,
  })
  for (let lv = 0; lv <= shelf.levels; lv++) {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(totalWidth, 0.04, totalDepth),
      shelfPlateMat
    )
    plate.position.y = lv * LEVEL_HEIGHT
    plate.receiveShadow = true
    plate.castShadow = true
    shelfGroup.add(plate)
  }

  const backPanel = new THREE.Mesh(
    new THREE.BoxGeometry(totalWidth, totalHeight, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 })
  )
  backPanel.position.set(0, totalHeight / 2, -totalDepth / 2)
  shelfGroup.add(backPanel)

  const startX = -totalWidth / 2 + 0.05 + SLOT_WIDTH / 2
  const startZ = -totalDepth / 2 + 0.05 + SLOT_DEPTH / 2

  shelf.slots.forEach((slot) => {
    if (!slot.cargo) return
    const x = startX + slot.column * (SLOT_WIDTH + 0.05)
    const z = startZ + slot.row * (SLOT_DEPTH + 0.05)
    const y = slot.level * LEVEL_HEIGHT + SLOT_HEIGHT / 2 + 0.05

    const cargoGeo = new THREE.BoxGeometry(SLOT_WIDTH * 0.85, SLOT_HEIGHT * 0.85, SLOT_DEPTH * 0.85)
    const cargoColor = new THREE.Color(slot.cargo.color || '#3498db')
    const cargoMat = new THREE.MeshStandardMaterial({
      color: cargoColor,
      roughness: 0.6,
      metalness: 0.1,
    })
    const cargo = new THREE.Mesh(cargoGeo, cargoMat)
    cargo.position.set(x, y, z)
    cargo.castShadow = true
    cargo.receiveShadow = true
    shelfGroup.add(cargo)

    const edgeGeo = new THREE.EdgesGeometry(cargoGeo)
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 })
    const edges = new THREE.LineSegments(edgeGeo, edgeMat)
    edges.position.copy(cargo.position)
    shelfGroup.add(edges)
  })

  group.add(shelfGroup)
}

function createAGV(agv) {
  const group = new THREE.Group()
  group.name = `agv-${agv.id}`

  const bodyColor = agv.status === 'charging' ? 0xfbbf24 : agv.status === 'idle' ? 0x64748b : 0x3b82f6

  const bodyGeo = new THREE.BoxGeometry(0.9, 0.4, 0.7)
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    metalness: 0.6,
    roughness: 0.3,
    emissive: bodyColor,
    emissiveIntensity: agv.status === 'working' ? 0.35 : 0.15,
  })
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  body.name = 'body'
  body.position.y = 0.35
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  const front = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.2, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x60a5fa, emissiveIntensity: 0.8 })
  )
  front.position.set(0, 0.35, 0.36)
  front.name = 'front'
  group.add(front)

  const topGeo = new THREE.BoxGeometry(0.7, 0.25, 0.5)
  const topMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.8,
    roughness: 0.2,
  })
  const top = new THREE.Mesh(topGeo, topMat)
  top.position.y = 0.65
  top.castShadow = true
  group.add(top)

  const wheelsGroup = new THREE.Group()
  wheelsGroup.name = 'wheels'
  const wheelGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.1, 16)
  wheelGeo.rotateZ(Math.PI / 2)
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.9,
  })
  const wheelOffsets = [
    [-0.35, 0.1, 0.35],
    [0.35, 0.1, 0.35],
    [-0.35, 0.1, -0.35],
    [0.35, 0.1, -0.35],
  ]
  wheelOffsets.forEach(([x, y, z]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat)
    wheel.position.set(x, y, z)
    wheel.castShadow = true
    wheelsGroup.add(wheel)
  })
  group.add(wheelsGroup)

  const lightGeo = new THREE.SphereGeometry(0.05, 12, 12)
  const lightColor = agv.status === 'working' ? 0x22c55e : 0xef4444
  const lightMat = new THREE.MeshBasicMaterial({ color: lightColor })
  const light1 = new THREE.Mesh(lightGeo, lightMat)
  light1.position.set(0, 0.82, 0)
  light1.name = 'statusLight'
  group.add(light1)

  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgba(15,23,42,0.9)'
  ctx.fillRect(0, 0, 128, 32)
  ctx.strokeStyle = bodyColor.toString(16).padStart(6, '0')
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, 126, 30)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 18px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(agv.name, 64, 16)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  const labelMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
  const label = new THREE.Sprite(labelMat)
  label.scale.set(1.2, 0.3, 1)
  label.position.y = 1.15
  label.name = 'label'
  group.add(label)

  return group
}
