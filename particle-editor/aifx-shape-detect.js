(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAifxShapeDetect = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // Work out what a black-background VFX clip is SHAPED like, so the prompt can
  // name it without asking the artist to write English.
  //
  // The silhouette has to be named or a restyle drifts into whatever the
  // material suggests (measured: IoU 0.187 unnamed vs 0.356 named, at the same
  // seed and denoise). Nothing about that naming needs a human: on a black plate
  // luminance is the matte, and the archetypes game VFX falls into separate
  // cleanly once the right things are measured.
  //
  // The obvious measures do not work, which is worth recording so they are not
  // tried again. A crescent's bounding box is nearly square, so "elongated"
  // never fires for it (measured 1.09). A pillar's box is widened by its ground
  // sigil, so "tall" never fires either (1.28). And a multi-ring burst fills its
  // own middle with more rings, so a plain centre-versus-rim test reads solid.
  // What does separate them: how much of the angle around the centre is covered
  // (a crescent leaves a gap, a ring does not), and how the width at the top
  // compares with the width at the bottom (a pillar tapers, a fireball does not).

  const THRESHOLD = 0.10   // luma floor; below this the pixel is background
  const GRID = 64          // every frame is measured on a 64x64 luma grid
  const ANGLE_BINS = 36

  // Seven of these phrases say "of light", "glowing" or "bright". That is right
  // when the material is named beside them, and wrong when a reference image is
  // supplying the material instead - the words then compete with the picture and
  // the model renders light. Measured on a copper photograph over the symbol
  // tile: with the light words the output came back at 0.003 saturation (plain
  // white), without them at 0.209 with the reference's own ridged crust and
  // red-hot cracks, and the motion held either way (envelope 0.883 vs 0.905).
  // It is also why the crescent never had this problem - `arc` names no light.
  // So the ones that mention light carry a second, plain wording for the
  // reference path. The rest have nothing to strip and fall back to `shape`.

  const ARCHETYPES = Object.freeze({
    frame: {
      label: '矩形边框',
      // "Frame" is an object noun in English. Once the init latent is loose
      // enough that only a coarse rectangle survives, a gold or chrome prompt
      // reads it as a literal picture frame and renders a solid ornate
      // moulding instead of a light effect. Naming what it must not be is the
      // same fix every other material needed.
      shape: 'rectangular border of light, a thin glowing outline around an empty middle with a '
        + 'bright pulse running along its edge. It is drawn light, NOT a solid picture frame, '
        + 'NOT a carved or moulded object, and it has NO thickness or depth',
      plainShape: 'rectangular border, a thin outline around an empty middle with a pulse '
        + 'running along its edge. It is a drawn band, NOT a solid picture frame, NOT a carved '
        + 'or moulded object, and it has NO thickness or depth',
    },
    ring: {
      label: '环形扩散',
      shape: 'circular burst, a bright centre with thin concentric rings expanding outward',
      plainShape: 'circular burst, a dense centre with thin concentric rings expanding outward',
    },
    band: {
      label: '横向冲击',
      shape: 'wide horizontal shock band, one flat bar of light spanning the frame from edge to '
        + 'edge that slams to a stop and pushes a flat wave of dust out to both sides. It stays '
        + 'low and wide, NOT a ring, NOT a ball',
      plainShape: 'wide horizontal shock band, one flat bar spanning the frame from edge to '
        + 'edge that slams to a stop and pushes a flat wave of dust out to both sides. It stays '
        + 'low and wide, NOT a ring, NOT a ball',
    },
    shatter: {
      label: '符号碎裂',
      // "Tile" on its own renders a roof tile as soon as the material is stone
      // or gold, the same trap "frame" fell into, so the panel is spelt out.
      shape: 'symbol tile shatter, one solid rounded-square panel of light that flashes bright '
        + 'and then breaks into angular shards that fly outward and fade. It starts as a single '
        + 'filled square, NOT an outline, NOT a ring, NOT a roof tile',
      plainShape: 'symbol tile shatter, one solid rounded-square panel that cracks and then '
        + 'breaks into angular shards that fly outward and fade. It starts as a single filled '
        + 'square, NOT an outline, NOT a ring, NOT a roof tile',
    },
    fountain: {
      label: '向上喷发',
      shape: 'upward fountain, a bright source low in the frame throwing a spreading cone of '
        + 'streaks and pieces UPWARD that arc over and tumble back down. It sprays upward, NOT '
        + 'outward in every direction, NOT a standing column',
      plainShape: 'upward fountain, a source low in the frame throwing a spreading cone of '
        + 'streaks and pieces UPWARD that arc over and tumble back down. It sprays upward, NOT '
        + 'outward in every direction, NOT a standing column',
    },
    rain: {
      label: '飘落下落',
      shape: 'falling shower, many separate small pieces dropping DOWNWARD from above the top of '
        + 'the frame, tumbling as they fall and passing out of the bottom. It falls, it does NOT '
        + 'rise, and there is NO single source it comes from',
    },
    swirl: {
      label: '旋转漩涡',
      shape: 'rotating vortex, two curved arms of light spiralling around a dark eye at the '
        + 'centre and turning steadily in one direction for the whole shot. The arms CURVE as '
        + 'they turn, they are NOT straight spokes and they do NOT fly apart',
      plainShape: 'rotating vortex, two curved arms spiralling around an empty eye at the '
        + 'centre and turning steadily in one direction for the whole shot. The arms CURVE as '
        + 'they turn, they are NOT straight spokes and they do NOT fly apart',
    },
    rays: {
      label: '放射光线',
      shape: 'radiating light rays, long thin straight wedges of light reaching from a small '
        + 'bright centre all the way out to the edges of the frame and turning slowly. The rays '
        + 'are straight and evenly spaced, NOT a shockwave, NOT flying debris',
      plainShape: 'radiating rays, long thin straight wedges reaching from a small dense '
        + 'centre all the way out to the edges of the frame and turning slowly. The rays are '
        + 'straight and evenly spaced, NOT a shockwave, NOT flying debris',
    },
    converge: {
      label: '汇聚吸入',
      shape: 'inward collect, scattered pieces spread across the frame that all fly INWARD and '
        + 'shrink toward a single point at the centre where they vanish',
    },
    burst: {
      label: '径向爆发',
      shape: 'radial burst, a core that blooms outward in all directions with an expanding '
        + 'shockwave and debris thrown out around it',
    },
    pillar: {
      label: '竖直光柱',
      shape: 'vertical pillar, a tall column standing on a flat circular base on the ground',
    },
    arc: {
      label: '弧线刀光',
      shape: 'crescent slash, one clean curved arc thick at the middle and tapering to sharp '
        + 'points at both tips',
    },
    trail: {
      label: '拖尾轨迹',
      shape: 'travelling streak, a long trail that sweeps across the frame leaving a tapering tail',
    },
    blob: {
      label: '团块聚集',
      shape: 'compact mass, a single rounded body that swells and then breaks apart',
    },
  })

  // Two of these have no detection rule: `swirl` and `rays` both read as
  // `burst`. Four measures were tried against the whole library - frame-to-
  // frame rotation of the angular histogram, the twist between an inner and an
  // outer radius band, counting radial streaks as peaks in the angular
  // profile, and how evenly the lit angles reach outward - and none of them
  // separated a spiral or a ray fan from an explosion by a margin worth a
  // rule (a ray fan's streak count is 9, and so is a coin collect's). They are
  // in the library because they are real PG-style effects worth prompting for:
  // the panel's chips pick them, and the two built-in templates name their own
  // archetype rather than pretend the detector found it.

  // Shape is only half of what the prompt has to name. A looping UI element - a
  // light chasing around a border, an idle shimmer - never breaks apart, and
  // every material description here ends with how it disperses, so a loop
  // handed the one-shot wording explodes at the end. Measured on the shipped
  // templates: a persistent element holds its energy to the last frame AND does
  // not grow, while a one-shot either fades out or expands. The tail alone is
  // not enough - an explosion's smoke keeps coverage at 0.82 - so both terms
  // are needed.
  const LIFECYCLES = Object.freeze({
    once: {
      label: '一次性',
      clause: 'appears, peaks, then breaks up and clears',
    },
    loop: {
      label: '循环常驻',
      clause: 'LOOPS: the same motion repeats over and over and the element stays whole and '
        + 'present for the entire shot. It does NOT break apart, scatter, dissolve or fade out',
    },
  })

  function gridOf(frame) {
    const { width, height, data } = frame
    const cells = new Float32Array(GRID * GRID)
    if (!width || !height) return cells
    for (let gy = 0; gy < GRID; gy += 1) {
      const y0 = Math.floor((gy * height) / GRID)
      const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / GRID))
      for (let gx = 0; gx < GRID; gx += 1) {
        const x0 = Math.floor((gx * width) / GRID)
        const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / GRID))
        let peak = 0
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const index = (y * width + x) * 4
            const value = (data[index] * 0.2126 + data[index + 1] * 0.7152
              + data[index + 2] * 0.0722) / 255
            if (value > peak) peak = value
          }
        }
        cells[gy * GRID + gx] = peak
      }
    }
    return cells
  }

  function boxOf(cells) {
    let count = 0
    let sumX = 0
    let sumY = 0
    let minX = GRID
    let maxX = -1
    let minY = GRID
    let maxY = -1
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        if (cells[y * GRID + x] <= THRESHOLD) continue
        count += 1
        sumX += x
        sumY += y
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (!count) return null
    const boxWidth = maxX - minX + 1
    const boxHeight = maxY - minY + 1
    return {
      count, minX, maxX, minY, maxY, boxWidth, boxHeight,
      coverage: count / (GRID * GRID),
      fill: count / (boxWidth * boxHeight),
      centreX: (minX + maxX) / 2,
      centreY: (minY + maxY) / 2,
      // The mass centroid, not the box centre: which way the element is
      // heading is a question about where its pixels are, and a fountain's
      // box stops growing the moment it touches the top of the frame.
      massX: sumX / count,
      massY: sumY / count,
      touchesBottom: maxY >= GRID - 3,
    }
  }

  // A closed ring covers every angle around its centre; a crescent leaves a gap
  // where its concave side is. This is what separates the two, and neither the
  // bounding box nor the fill ratio can.
  function angularCoverage(cells, box) {
    const bins = new Uint8Array(ANGLE_BINS)
    const rx = Math.max(1e-6, box.boxWidth / 2)
    const ry = Math.max(1e-6, box.boxHeight / 2)
    for (let y = box.minY; y <= box.maxY; y += 1) {
      for (let x = box.minX; x <= box.maxX; x += 1) {
        if (cells[y * GRID + x] <= THRESHOLD) continue
        const nx = (x - box.centreX) / rx
        const ny = (y - box.centreY) / ry
        if (Math.sqrt(nx * nx + ny * ny) < 0.35) continue
        const bin = Math.floor(((Math.atan2(ny, nx) + Math.PI) / (2 * Math.PI)) * ANGLE_BINS)
        bins[Math.min(ANGLE_BINS - 1, Math.max(0, bin))] = 1
      }
    }
    let filled = 0
    for (const bin of bins) filled += bin
    return filled / ANGLE_BINS
  }

  // Does the middle open up? Measured profiles settle this: the ring clip starts
  // as a solid flash (inner bands 1.00) and only voids out late (0.09, then
  // 0.04) while a band further out still holds; the fireball's middle reads 1.00
  // from the first frame to the last. So this is a question about the late part
  // of the clip, and the answer is the inner bands against the best outer band -
  // not the peak's position, which a second inner ring moves inward anyway.
  const RADIAL_BANDS = 8

  function centreVoid(cells, box) {
    const rx = Math.max(1e-6, box.boxWidth / 2)
    const ry = Math.max(1e-6, box.boxHeight / 2)
    const on = new Float64Array(RADIAL_BANDS)
    const total = new Float64Array(RADIAL_BANDS)
    for (let y = box.minY; y <= box.maxY; y += 1) {
      for (let x = box.minX; x <= box.maxX; x += 1) {
        const nx = (x - box.centreX) / rx
        const ny = (y - box.centreY) / ry
        const radius = Math.sqrt(nx * nx + ny * ny)
        if (radius > 1) continue
        const band = Math.min(RADIAL_BANDS - 1, Math.floor(radius * RADIAL_BANDS))
        total[band] += 1
        if (cells[y * GRID + x] > THRESHOLD) on[band] += 1
      }
    }
    const profile = []
    for (let band = 0; band < RADIAL_BANDS; band += 1) {
      profile.push(total[band] >= 4 ? on[band] / total[band] : 0)
    }
    const outer = Math.max(...profile.slice(2))
    if (outer <= 0.05) return 0
    const middle = (profile[0] + profile[1]) / 2
    return Math.max(0, (outer - middle) / outer)
  }

  // A rectangular border reaches into the corners of its own bounding box; a
  // circle cannot. Both are hollow and both close the angle, so nothing already
  // measured here tells them apart - and a border handed the "concentric rings"
  // phrase would be described wrongly to the model.
  // The inset must stay under 0.146 of the box: an inscribed circle reaches a
  // corner window bigger than that (solve x^2+y^2=r^2 with both x,y past the
  // window edge), and every ring would read as a frame. 0.10 leaves margin.
  function cornerOccupancy(cells, box) {
    const inset = 0.10
    const dx = Math.max(1, Math.round(box.boxWidth * inset))
    const dy = Math.max(1, Math.round(box.boxHeight * inset))
    const corners = [
      [box.minX, box.minY], [box.maxX - dx + 1, box.minY],
      [box.minX, box.maxY - dy + 1], [box.maxX - dx + 1, box.maxY - dy + 1],
    ]
    let hit = 0
    for (const [x0, y0] of corners) {
      let found = false
      for (let y = y0; y < y0 + dy && !found; y += 1) {
        for (let x = x0; x < x0 + dx; x += 1) {
          if (cells[y * GRID + x] > THRESHOLD) { found = true; break }
        }
      }
      if (found) hit += 1
    }
    return hit / 4
  }

  // A pillar is narrow where it rises and wide where it stands. A fireball is
  // the same width all the way up, which is what the bounding box alone missed.
  function topTaper(cells, box) {
    const bandWidth = (y0, y1) => {
      let minX = GRID
      let maxX = -1
      for (let y = y0; y <= y1; y += 1) {
        for (let x = box.minX; x <= box.maxX; x += 1) {
          if (cells[y * GRID + x] <= THRESHOLD) continue
          if (x < minX) minX = x
          if (x > maxX) maxX = x
        }
      }
      return maxX < minX ? 0 : maxX - minX + 1
    }
    const third = Math.max(1, Math.round(box.boxHeight * 0.35))
    const top = bandWidth(box.minY, Math.min(box.maxY, box.minY + third - 1))
    const bottom = bandWidth(Math.max(box.minY, box.maxY - third + 1), box.maxY)
    if (!bottom) return 1
    return top / bottom
  }

  // How far the lit mass sits from a fixed anchor. The bounding box cannot
  // answer this: a collect animation keeps a few stray sparks out at the rim
  // for most of the shot, so its box barely shrinks (measured 0.74) while the
  // mass itself collapses to a quarter of its spread (0.27).
  function meanRadius(cells, anchorX, anchorY) {
    let count = 0
    let sum = 0
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        if (cells[y * GRID + x] <= THRESHOLD) continue
        count += 1
        sum += Math.hypot(x - anchorX, y - anchorY)
      }
    }
    return count ? sum / count / GRID : 0
  }

  // Separate lit pieces, counted on a half-resolution grid so a shower of
  // coins does not split into one component per sparkle. Only used to tell
  // "many independent objects" from "one body".
  const PIECE_GRID = GRID >> 1
  const PIECE_MIN = 4

  function pieceCount(cells) {
    const coarse = new Uint8Array(PIECE_GRID * PIECE_GRID)
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        if (cells[y * GRID + x] > THRESHOLD) coarse[(y >> 1) * PIECE_GRID + (x >> 1)] = 1
      }
    }
    const seen = new Uint8Array(PIECE_GRID * PIECE_GRID)
    const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    let pieces = 0
    for (let start = 0; start < coarse.length; start += 1) {
      if (!coarse[start] || seen[start]) continue
      let size = 0
      const stack = [start]
      seen[start] = 1
      while (stack.length) {
        const index = stack.pop()
        size += 1
        const px = index % PIECE_GRID
        const py = (index / PIECE_GRID) | 0
        for (const [dx, dy] of neighbours) {
          const nx = px + dx
          const ny = py + dy
          if (nx < 0 || ny < 0 || nx >= PIECE_GRID || ny >= PIECE_GRID) continue
          const next = ny * PIECE_GRID + nx
          if (coarse[next] && !seen[next]) { seen[next] = 1; stack.push(next) }
        }
      }
      if (size >= PIECE_MIN) pieces += 1
    }
    return pieces
  }

  function median(values) {
    if (!values.length) return 0
    const sorted = values.slice().sort((a, b) => a - b)
    const middle = sorted.length >> 1
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  }

  /**
   * @param frames  array of ImageData-like objects ({width, height, data})
   */
  function analyse(frames) {
    const measured = []
    // Coverage for EVERY input frame, including the ones that are fully black.
    // Empty frames are dropped from `measured` because they have no geometry,
    // but a clip that fades all the way out is exactly the case the lifecycle
    // test needs to see - leaving them out made a fading crescent read as a
    // persistent one.
    const coverageAll = []
    for (const frame of frames || []) {
      const cells = gridOf(frame)
      const box = boxOf(cells)
      coverageAll.push(box ? box.coverage : 0)
      if (box) measured.push({ cells, box })
    }
    if (measured.length < 2) {
      return {
        archetype: 'blob',
        ...ARCHETYPES.blob,
        lifecycle: 'once',
        lifecycleLabel: LIFECYCLES.once.label,
        lifecycleClause: LIFECYCLES.once.clause,
        metrics: { frames: measured.length },
      }
    }

    // Judge the clip where it is actually alive. Lead-in and tail are a spark or
    // a few embers, and every ratio taken there is noise.
    const peak = Math.max(...measured.map(item => item.box.coverage))
    const live = measured.filter(item => item.box.coverage > peak * 0.35)
    const sample = live.length >= 3 ? live : measured
    const late = sample.slice(Math.floor(sample.length * 0.4))

    // Growth is the one measure that must NOT use the live window. That window
    // drops the frames below a third of peak coverage, which for an explosion
    // is exactly its expansion phase - measured, it turned a 2.7x expansion
    // into 1.07 and the explosion stopped reading as a burst.
    const extentOf = (item) => Math.max(item.box.boxWidth, item.box.boxHeight)
    const birth = measured.slice(0, Math.max(1, Math.round(measured.length * 0.25)))
    const death = measured.slice(-Math.max(1, Math.round(measured.length * 0.25)))
    const growth = Math.max(...measured.map(extentOf)) / Math.max(1, median(birth.map(extentOf)))
    // growth only ever reports the largest the element got, so an effect that
    // starts wide and gathers inward is invisible to it. End against start is.
    const shrink = median(death.map(extentOf)) / Math.max(1, median(birth.map(extentOf)))

    // Radial versions of the same two questions, anchored on the busiest
    // frame's centre of mass. These are what actually catch a collect
    // animation: the box-based pair reads 0.74 for it, no different from an
    // ordinary flame, while the radial pair reads 0.27.
    const anchor = measured.reduce((best, item) =>
      (item.box.coverage > best.box.coverage ? item : best)).box
    const radiusOf = (item) => meanRadius(item.cells, anchor.massX, anchor.massY)
    const birthRadius = Math.max(1e-6, median(birth.map(radiusOf)))
    const radialShrink = median(death.map(radiusOf)) / birthRadius
    const radialGrow = Math.max(...measured.map(radiusOf)) / birthRadius

    // Travel uses the box centre, not the intensity centroid: a fading element
    // drags its centroid around without actually going anywhere.
    let travel = 0
    // Sideways travel on its own, because a fountain and a diagonal sweep both
    // rise off a bottom anchor and only the sweep goes across: measured 0.01
    // for a coin fountain against 0.30 for a sparkle wipe.
    let travelX = 0
    for (const a of sample) {
      for (const b of sample) {
        travel = Math.max(travel,
          Math.hypot(a.box.centreX - b.box.centreX, a.box.centreY - b.box.centreY) / GRID)
        travelX = Math.max(travelX, Math.abs(a.box.centreX - b.box.centreX) / GRID)
      }
    }

    // A running light traces its shape out over time: at any one frame a border
    // pulse lights only part of the rectangle, so the per-frame median angular
    // coverage reads 0.64 and the frame looks like an arc. The union over the
    // clip is what the element actually is. A crescent unions to a crescent, so
    // this does not blur the two.
    const union = new Float32Array(GRID * GRID)
    for (const item of sample) {
      for (let index = 0; index < union.length; index += 1) {
        if (item.cells[index] > union[index]) union[index] = item.cells[index]
      }
    }
    const unionBox = boxOf(union)

    const metrics = {
      frames: measured.length,
      angularUnion: unionBox ? angularCoverage(union, unionBox) : 0,
      cornersUnion: unionBox ? cornerOccupancy(union, unionBox) : 0,
      // The union's middle is empty for a border but filled for a ring, whose
      // opening flash covers it. Neither measure alone catches both, so the
      // ring test accepts either.
      hollowUnion: unionBox ? centreVoid(union, unionBox) : 0,
      fill: median(sample.map(item => item.box.fill)),
      angular: median(sample.map(item => angularCoverage(item.cells, item.box))),
      hollow: Math.max(0, ...late.map(item => centreVoid(item.cells, item.box))),
      taper: median(sample.map(item => topTaper(item.cells, item.box))),
      corners: median(sample.map(item => cornerOccupancy(item.cells, item.box))),
      bottomAnchored: sample.filter(item => item.box.touchesBottom).length / sample.length,
      // How high the element ever reaches. Like the void test this is a "did it
      // at some point" question: a pillar grows from short to tall, so a median
      // is dragged up by its own early frames.
      topReach: Math.min(...sample.map(item => item.box.minY)) / GRID,
      growth,
      shrink,
      radialShrink,
      radialGrow,
      // Which way the mass moves over the clip. Positive is upward, because y
      // grows downward in image space.
      rise: (median(birth.map(item => item.box.massY))
        - median(death.map(item => item.box.massY))) / GRID,
      // How solid the element is to begin with. A square tile fills its own
      // box (measured 0.96); a disc cannot beat pi/4, and an explosion
      // measured exactly that (0.795). So this is really "is it a rectangle".
      solidStart: median(birth.map(item => item.box.fill)),
      aspect: median(sample.map(item => item.box.boxWidth / item.box.boxHeight)),
      pieces: median(sample.map(item => pieceCount(item.cells))),
      travel,
      travelX,
      peakCoverage: peak,
      // Energy still alive at the very end, against the clip's peak.
      tailEnergy: median(coverageAll.slice(-Math.max(1, Math.round(coverageAll.length / 6))))
        / Math.max(1e-6, peak),
    }

    // Most specific first: a pillar is also radial at its base, and a ring is
    // also a burst.
    let archetype = 'blob'
    if (metrics.bottomAnchored > 0.7 && metrics.taper < 0.6 && metrics.topReach < 0.25) {
      archetype = 'pillar'
    }
    // A coin fountain and a treasure burst are bottom-anchored and go UP; a
    // detonation of the same size goes everywhere. Among bottom-anchored
    // clips the fountains measured 0.07 to 0.27 and everything else topped out
    // at 0.014, so the line sits at 0.04. It is deliberately not 0.10: the
    // panel decodes 26 frames where the offline dump had 39, and the same
    // treasure burst reads 0.115 against 0.072 depending on which it is.
    // The sideways term keeps a diagonal sweep out, because that rises too -
    // and it has to be sideways travel, not total, since a fountain's own box
    // climbs as the cone grows.
    else if (metrics.bottomAnchored > 0.5 && metrics.rise > 0.04 && metrics.travelX < 0.15) {
      archetype = 'fountain'
    }
    // A symbol tile is the one element that starts as a filled rectangle and
    // ends as shards: solidStart 0.96 with its mass flying out to 4.4x. A
    // reel-stop band is just as solid (0.99) but only spreads to 1.6x.
    else if (metrics.solidStart > 0.85 && metrics.radialGrow > 2.0) {
      archetype = 'shatter'
    }
    // Hollow has to be near-total, and the thing has to be one closed body.
    // At the old 0.45 a reel-stop band (0.67) and a coin shower (0.77) both
    // claimed to be rings, where a real ring measured 0.97 and a border 1.00;
    // and a shower with a gap in its middle still reads 0.85 hollow with every
    // angle covered, which the piece count settles - every ring, border and
    // portal in the library is 1 to 2.5 pieces against the shower's 8 to 14.
    // The union term stays because a running border light is never hollow in
    // any single frame.
    else if ((metrics.hollow > 0.85 || metrics.hollowUnion > 0.45)
      && metrics.angularUnion > 0.9 && metrics.pieces <= 3) {
      // A border stays hollow across the whole clip. An expanding ring does
      // not - its opening flash fills the middle of the union - and a
      // shattering tile fills it outright.
      archetype = metrics.cornersUnion > 0.85 && metrics.hollowUnion > 0.45 ? 'frame' : 'ring'
    }
    // A reel stop is wide from its first frame and stays that width; a payline
    // sweep is just as wide at its peak but draws itself out to get there
    // (growth 2.91 against 1.23).
    else if (metrics.aspect > 1.8 && metrics.growth < 1.6) archetype = 'band'
    // Falling is not just "the mass moved down": a multiplier pop drops 0.33
    // when its rings vanish. A shower is many separate pieces (8) that keep
    // their spread (0.91) while they fall, where the pop is one core
    // (radialShrink 0.30) with a bright middle left behind.
    else if (metrics.rise < -0.15 && metrics.pieces >= 4 && metrics.radialShrink > 0.6) {
      archetype = 'rain'
    }
    // Everything else in the library moves outward. A collect animation is the
    // one that gathers, and it gathers where it stands. This asks about motion
    // rather than silhouette, so it comes before the silhouette rules: a
    // sparse field of coins closing in only covers 0.79 of the angle and would
    // otherwise be called an arc. The travel term is what keeps a payline
    // sweep out - that also ends up smaller than it started (0.44 once the
    // panel's 26-frame decode is what gets measured, against 0.56 on the full
    // 39) but it crosses the frame to get there: 0.43 travel against 0.03.
    else if (metrics.radialShrink < 0.5 && metrics.radialGrow < 1.2 && metrics.travel < 0.25) {
      archetype = 'converge'
    }
    // A streak that crosses the frame is a trail, not an arc. Both are
    // elongated with an angular gap, so travel has to break the tie first: a
    // crescent barely moves (measured 0.20) while a payline sweep crosses half
    // the frame (0.46).
    else if (metrics.travel > 0.35) archetype = 'trail'
    else if (metrics.angular < 0.85 && metrics.fill < 0.5) archetype = 'arc'
    // A burst has to actually grow. Keying on "fills its box and sits still"
    // instead made every stationary flame mass a burst. But a flare that is
    // already full size in its first frames never "grows" either, and
    // a centred mass that closes the angle completely is still a burst rather
    // than a blob. 0.95 separates it from a flame mass, which measured 0.92.
    else if (metrics.growth > 1.25
      || (metrics.angularUnion > 0.95 && metrics.travel < 0.12 && metrics.fill > 0.45)) {
      archetype = 'burst'
    }
    else if (metrics.travel > 0.25) archetype = 'trail'

    const lifecycle = metrics.tailEnergy > 0.6 && metrics.growth < 1.3 ? 'loop' : 'once'
    // Spread only the archetype: LIFECYCLES also has a `label` and would win.
    return {
      archetype,
      ...ARCHETYPES[archetype],
      lifecycle,
      lifecycleLabel: LIFECYCLES[lifecycle].label,
      lifecycleClause: LIFECYCLES[lifecycle].clause,
      metrics,
    }
  }

  return Object.freeze({ THRESHOLD, GRID, ARCHETYPES, LIFECYCLES, analyse })
})
