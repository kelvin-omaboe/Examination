(function () {
  if (AFRAME.components["float-bob"]) {
    return;
  }

  // Deterministic pseudo-random generator for repeatable scene decoration.
  function mulberry32(seed) {
    var t = seed;
    return function () {
      t += 0x6d2b79f5;
      var r = Math.imul(t ^ (t >>> 15), t | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Uniform random point inside a ring (used for vegetation placement).
  function randomPointInRing(rng, innerRadius, outerRadius) {
    var angle = rng() * Math.PI * 2;
    var radiusSq =
      innerRadius * innerRadius +
      rng() * (outerRadius * outerRadius - innerRadius * innerRadius);
    var radius = Math.sqrt(radiusSq);
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
    };
  }

  function randomItem(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  // Fast AABB check for exclusion zones on the island.
  function isPointInsideRect(point, rect) {
    return (
      point.x >= rect.xMin &&
      point.x <= rect.xMax &&
      point.z >= rect.zMin &&
      point.z <= rect.zMax
    );
  }

  // Simple sinusoidal motion for floating props (clouds, vehicles, etc.).
  AFRAME.registerComponent("float-bob", {
    schema: {
      amplitude: { type: "number", default: 0.08 },
      speed: { type: "number", default: 1 },
      phase: { type: "number", default: 0 },
      axis: { type: "string", default: "y" },
    },

    init: function () {
      this.origin = this.el.object3D.position.clone();
    },

    tick: function (time) {
      var axis = this.data.axis;
      var offset =
        Math.sin(time * 0.001 * this.data.speed + this.data.phase) *
        this.data.amplitude;
      this.el.object3D.position.copy(this.origin);
      if (axis === "x") {
        this.el.object3D.position.x += offset;
      } else if (axis === "z") {
        this.el.object3D.position.z += offset;
      } else {
        this.el.object3D.position.y += offset;
      }
    },
  });

  // Circular flight/orbit path with optional vertical bob and facing direction.
  AFRAME.registerComponent("orbit-motion", {
    schema: {
      radius: { type: "number", default: 24 },
      speed: { type: "number", default: 0.2 },
      height: { type: "number", default: 8 },
      bob: { type: "number", default: 0.4 },
      center: { type: "vec3", default: { x: 0, y: 0, z: 0 } },
      yawOffset: { type: "number", default: 90 },
    },

    init: function () {
      this.startAngle = Math.random() * Math.PI * 2;
      this.yawOffsetRad = THREE.MathUtils.degToRad(this.data.yawOffset);
    },

    tick: function (time) {
      var angle = this.startAngle + time * 0.001 * this.data.speed;
      var pos = this.el.object3D.position;

      pos.x = this.data.center.x + Math.cos(angle) * this.data.radius;
      pos.z = this.data.center.z + Math.sin(angle) * this.data.radius;
      pos.y = this.data.height + Math.sin(angle * 1.8) * this.data.bob;

      this.el.object3D.rotation.y = -angle + this.yawOffsetRad;
    },
  });

  // Keeps camera/player constrained to the playable island region.
  AFRAME.registerComponent("island-boundary", {
    schema: {
      radius: { type: "number", default: 36 },
      minY: { type: "number", default: 1.46 },
      lockY: { type: "boolean", default: true },
    },

    tick: function () {
      var pos = this.el.object3D.position;
      var distSq = pos.x * pos.x + pos.z * pos.z;
      var maxDistSq = this.data.radius * this.data.radius;

      if (distSq > maxDistSq) {
        var scale = this.data.radius / Math.sqrt(distSq);
        pos.x *= scale;
        pos.z *= scale;
      }

      if (this.data.lockY && Math.abs(pos.y - this.data.minY) > 0.001) {
        pos.y = this.data.minY;
      }
    },
  });

  // Adds keyboard-controlled vertical movement between floors.
  AFRAME.registerComponent("vertical-controls", {
    schema: {
      upKey: { type: "string", default: "KeyE" },
      downKey: { type: "string", default: "KeyQ" },
      speed: { type: "number", default: 4.2 },
      minY: { type: "number", default: 1.6 },
      maxY: { type: "number", default: 24.0 },
      enabled: { type: "boolean", default: true },
    },

    init: function () {
      this.input = { up: false, down: false };
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onKeyUp = this.onKeyUp.bind(this);
      this.onWindowBlur = this.onWindowBlur.bind(this);
      window.addEventListener("keydown", this.onKeyDown);
      window.addEventListener("keyup", this.onKeyUp);
      window.addEventListener("blur", this.onWindowBlur);
    },

    remove: function () {
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);
      window.removeEventListener("blur", this.onWindowBlur);
    },

    isTypingTarget: function (target) {
      if (!target) {
        return false;
      }
      if (target.isContentEditable) {
        return true;
      }
      var tag = target.tagName ? target.tagName.toLowerCase() : "";
      return tag === "input" || tag === "textarea" || tag === "select";
    },

    onKeyDown: function (event) {
      if (!this.data.enabled || this.isTypingTarget(event.target)) {
        return;
      }
      if (event.code === this.data.upKey) {
        this.input.up = true;
        event.preventDefault();
      } else if (event.code === this.data.downKey) {
        this.input.down = true;
        event.preventDefault();
      }
    },

    onKeyUp: function (event) {
      if (event.code === this.data.upKey) {
        this.input.up = false;
      } else if (event.code === this.data.downKey) {
        this.input.down = false;
      }
    },

    onWindowBlur: function () {
      this.input.up = false;
      this.input.down = false;
    },

    tick: function (time, delta) {
      if (!this.data.enabled || !delta) {
        return;
      }

      var direction = (this.input.up ? 1 : 0) - (this.input.down ? 1 : 0);
      if (direction === 0) {
        return;
      }

      var pos = this.el.object3D.position;
      pos.y += direction * this.data.speed * (delta / 1000);
      if (pos.y < this.data.minY) {
        pos.y = this.data.minY;
      }
      if (pos.y > this.data.maxY) {
        pos.y = this.data.maxY;
      }
    },
  });

  // Procedurally builds stair flights to keep markup compact and consistent.
  AFRAME.registerComponent("stair-flight", {
    schema: {
      steps: { type: "int", default: 14 },
      rise: { type: "number", default: 0.232 },
      run: { type: "number", default: 0.22 },
      width: { type: "number", default: 1.4 },
      landingDepth: { type: "number", default: 0.9 },
      color: { type: "color", default: "#d8d5ce" },
      roughness: { type: "number", default: 0.75 },
      metalness: { type: "number", default: 0.02 },
    },

    init: function () {
      this.build();
    },

    update: function (oldData) {
      if (!oldData || Object.keys(oldData).length === 0) {
        return;
      }
      this.build();
    },

    remove: function () {
      this.clear();
    },

    clear: function () {
      while (this.el.firstChild) {
        this.el.removeChild(this.el.firstChild);
      }
    },

    build: function () {
      this.clear();

      var steps = Math.max(1, this.data.steps);
      var rise = this.data.rise;
      var run = this.data.run;
      var width = this.data.width;

      for (var i = 0; i < steps; i++) {
        var step = document.createElement("a-entity");
        step.setAttribute(
          "geometry",
          "primitive: box; width: " +
            width.toFixed(3) +
            "; height: " +
            rise.toFixed(3) +
            "; depth: " +
            run.toFixed(3),
        );
        step.setAttribute(
          "position",
          "0 " +
            ((i + 0.5) * rise).toFixed(3) +
            " " +
            ((i + 0.5) * run).toFixed(3),
        );
        step.setAttribute(
          "material",
          "color: " +
            this.data.color +
            "; roughness: " +
            this.data.roughness +
            "; metalness: " +
            this.data.metalness,
        );
        step.setAttribute("shadow", "cast: true; receive: true");
        this.el.appendChild(step);
      }

      var landing = document.createElement("a-entity");
      landing.setAttribute(
        "geometry",
        "primitive: box; width: " +
          width.toFixed(3) +
          "; height: 0.12; depth: " +
          this.data.landingDepth.toFixed(3),
      );
      landing.setAttribute(
        "position",
        "0 " +
          (steps * rise + 0.06).toFixed(3) +
          " " +
          (steps * run + this.data.landingDepth * 0.5).toFixed(3),
      );
      landing.setAttribute(
        "material",
        "color: " +
          this.data.color +
          "; roughness: " +
          this.data.roughness +
          "; metalness: " +
          this.data.metalness,
      );
      landing.setAttribute("shadow", "cast: true; receive: true");
      this.el.appendChild(landing);
    },
  });

  // Populates island vegetation with deterministic random placement.
  AFRAME.registerComponent("island-vegetation", {
    schema: {
      treeCount: { type: "int", default: 40 },
      plantCount: { type: "int", default: 70 },
      islandRadius: { type: "number", default: 33 },
      innerClearRadius: { type: "number", default: 10 },
      seed: { type: "int", default: 11 },
    },

    init: function () {
      this.build();
    },

    update: function (oldData) {
      if (!oldData || Object.keys(oldData).length === 0) {
        return;
      }
      this.clear();
      this.build();
    },

    remove: function () {
      this.clear();
    },

    clear: function () {
      while (this.el.firstChild) {
        this.el.removeChild(this.el.firstChild);
      }
    },

    build: function () {
      var rng = mulberry32(this.data.seed);
      var plantPalette = ["#5f9c4d", "#4f7c40", "#669f58"];
      var treeTintPalette = ["#ffffff", "#f5f9ef", "#edf5e4", "#f8fff3"];
      var treeTextureSelector = "#treeBillboardTex";
      var treeTextureAspect = 315 / 350;
      // Prevent trees/plants from spawning where the swimming pool sits.
      var noVegetationRects = [
        { xMin: 11, xMax: 25, zMin: -20, zMax: -7 },
        { xMin: -40, xMax: 40, zMin: 2, zMax: 78 },
      ];
      var fragment = document.createDocumentFragment();

      for (var i = 0; i < this.data.treeCount; i++) {
        var point = randomPointInRing(
          rng,
          this.data.innerClearRadius + 3,
          this.data.islandRadius - 1.6,
        );
        if (point.x < -10 && point.z < -6) {
          continue;
        }
        if (point.x > 6 && point.z > 11) {
          continue;
        }
        if (
          noVegetationRects.some(function (rect) {
            return isPointInsideRect(point, rect);
          })
        ) {
          continue;
        }

        var tree = document.createElement("a-entity");
        tree.setAttribute(
          "position",
          point.x.toFixed(2) + " 0 " + point.z.toFixed(2),
        );
        tree.setAttribute("rotation", "0 " + Math.floor(rng() * 360) + " 0");

        var treeHeight = 4.8 + rng() * 3.2;
        var treeWidth = treeHeight * treeTextureAspect * (0.9 + rng() * 0.2);
        var trunkHeight = treeHeight * (0.22 + rng() * 0.05);
        var trunkRadius = 0.14 + rng() * 0.08;
        var treeTint = randomItem(rng, treeTintPalette);

        var trunk = document.createElement("a-entity");
        trunk.setAttribute(
          "geometry",
          "primitive: cylinder; radius: " +
            trunkRadius.toFixed(3) +
            "; height: " +
            trunkHeight.toFixed(2) +
            "; segmentsRadial: 8",
        );
        trunk.setAttribute(
          "material",
          "color: #674827; roughness: 1; metalness: 0",
        );
        trunk.setAttribute(
          "position",
          "0 " + (trunkHeight * 0.5).toFixed(2) + " 0",
        );
        trunk.setAttribute("shadow", "cast: true; receive: true");
        tree.appendChild(trunk);

        for (var c = 0; c < 3; c++) {
          var card = document.createElement("a-entity");
          card.setAttribute(
            "geometry",
            "primitive: plane; width: " +
              treeWidth.toFixed(2) +
              "; height: " +
              treeHeight.toFixed(2),
          );
          card.setAttribute(
            "material",
            "src: " +
              treeTextureSelector +
              "; color: " +
              treeTint +
              "; transparent: true; alphaTest: 0.45; side: double; roughness: 1; metalness: 0",
          );
          card.setAttribute(
            "position",
            "0 " + (treeHeight * 0.5).toFixed(2) + " 0",
          );
          card.setAttribute(
            "rotation",
            "0 " + (c * 60 + (rng() * 8 - 4)).toFixed(2) + " 0",
          );
          card.setAttribute("shadow", "cast: true; receive: true");
          tree.appendChild(card);
        }

        fragment.appendChild(tree);
      }

      for (var j = 0; j < this.data.plantCount; j++) {
        var plantPoint = randomPointInRing(
          rng,
          this.data.innerClearRadius + 1.5,
          this.data.islandRadius - 0.7,
        );
        if (plantPoint.x < -11 && plantPoint.z < -5.5) {
          continue;
        }
        if (
          noVegetationRects.some(function (rect) {
            return isPointInsideRect(plantPoint, rect);
          })
        ) {
          continue;
        }

        if (j % 7 === 0) {
          var flower = document.createElement("a-entity");
          flower.setAttribute("gltf-model", "#flowerModel");
          flower.setAttribute(
            "position",
            plantPoint.x.toFixed(2) + " 0 " + plantPoint.z.toFixed(2),
          );
          flower.setAttribute(
            "rotation",
            "0 " + Math.floor(rng() * 360) + " 0",
          );
          var flowerScale = 0.55 + rng() * 0.4;
          flower.setAttribute(
            "scale",
            flowerScale.toFixed(2) +
              " " +
              flowerScale.toFixed(2) +
              " " +
              flowerScale.toFixed(2),
          );
          fragment.appendChild(flower);
          continue;
        }

        var shrub = document.createElement("a-entity");
        shrub.setAttribute(
          "position",
          plantPoint.x.toFixed(2) + " 0 " + plantPoint.z.toFixed(2),
        );
        shrub.setAttribute("rotation", "0 " + Math.floor(rng() * 360) + " 0");

        var leafA = document.createElement("a-entity");
        leafA.setAttribute(
          "geometry",
          "primitive: cone; radiusBottom: " +
            (0.18 + rng() * 0.1).toFixed(2) +
            "; radiusTop: 0.02; height: " +
            (0.5 + rng() * 0.3).toFixed(2) +
            "; segmentsRadial: 6",
        );
        leafA.setAttribute(
          "material",
          "color: " + randomItem(rng, plantPalette) + "; roughness: 1",
        );
        leafA.setAttribute(
          "position",
          "0 " + (0.25 + rng() * 0.08).toFixed(2) + " 0",
        );
        leafA.setAttribute("shadow", "cast: true; receive: true");
        shrub.appendChild(leafA);

        var leafB = document.createElement("a-entity");
        leafB.setAttribute(
          "geometry",
          "primitive: cone; radiusBottom: " +
            (0.14 + rng() * 0.08).toFixed(2) +
            "; radiusTop: 0.01; height: " +
            (0.42 + rng() * 0.24).toFixed(2) +
            "; segmentsRadial: 6",
        );
        leafB.setAttribute(
          "material",
          "color: " + randomItem(rng, plantPalette) + "; roughness: 1",
        );
        leafB.setAttribute(
          "position",
          (rng() * 0.16 - 0.08).toFixed(2) +
            " " +
            (0.2 + rng() * 0.08).toFixed(2) +
            " " +
            (rng() * 0.16 - 0.08).toFixed(2),
        );
        leafB.setAttribute("rotation", "0 " + Math.floor(rng() * 180) + " 0");
        leafB.setAttribute("shadow", "cast: true; receive: true");
        shrub.appendChild(leafB);

        if (j % 9 === 0) {
          var rock = document.createElement("a-entity");
          var rockSize = 0.1 + rng() * 0.12;
          rock.setAttribute(
            "geometry",
            "primitive: dodecahedron; radius: " + rockSize.toFixed(2),
          );
          rock.setAttribute("material", "color: #7f7f7f; roughness: 1");
          rock.setAttribute(
            "position",
            (rng() * 0.28 - 0.14).toFixed(2) +
              " " +
              (rockSize * 0.6).toFixed(2) +
              " " +
              (rng() * 0.28 - 0.14).toFixed(2),
          );
          rock.setAttribute("shadow", "cast: true; receive: true");
          shrub.appendChild(rock);
        }

        fragment.appendChild(shrub);
      }

      this.el.appendChild(fragment);
    },
  });

  // Adds a dense background tree line behind the house to fake an infinite forest.
  AFRAME.registerComponent("back-forest", {
    schema: {
      treeCount: { type: "int", default: 240 },
      edgeCount: { type: "int", default: 120 },
      islandRadius: { type: "number", default: 82 },
      minZ: { type: "number", default: 54 },
      maxZ: { type: "number", default: 82 },
      centerClearWidth: { type: "number", default: 14 },
      centerClearZ: { type: "number", default: 63 },
      seed: { type: "int", default: 73 },
    },

    init: function () {
      this.build();
    },

    update: function (oldData) {
      if (!oldData || Object.keys(oldData).length === 0) {
        return;
      }
      this.clear();
      this.build();
    },

    remove: function () {
      this.clear();
    },

    clear: function () {
      while (this.el.firstChild) {
        this.el.removeChild(this.el.firstChild);
      }
    },

    build: function () {
      var rng = mulberry32(this.data.seed);
      var treeTextureSelector = "#treeBillboardTex";
      var treeTextureAspect = 315 / 350;
      var nearTintPalette = ["#f8fff3", "#eef8e7", "#e6f2db", "#deecd1"];
      var farTintPalette = ["#dbe7cd", "#d0dfc1", "#c7d7ba", "#bfd1b2"];

      var fragment = document.createDocumentFragment();
      var maxRadius = Math.max(this.data.islandRadius - 0.8, 2);
      var maxZ = Math.min(this.data.maxZ, maxRadius);
      var minZ = Math.min(this.data.minZ, maxZ - 0.5);
      var maxRadiusSq = maxRadius * maxRadius;

      var appendTree = function (
        point,
        minHeight,
        maxHeight,
        tintPalette,
        trunkProbability,
      ) {
        var tree = document.createElement("a-entity");
        tree.setAttribute(
          "position",
          point.x.toFixed(2) + " 0 " + point.z.toFixed(2),
        );
        tree.setAttribute("rotation", "0 " + Math.floor(rng() * 360) + " 0");

        var treeHeight = minHeight + rng() * (maxHeight - minHeight);
        var treeWidth = treeHeight * treeTextureAspect * (0.88 + rng() * 0.26);
        var treeTint = randomItem(rng, tintPalette);

        if (rng() < trunkProbability) {
          var trunkHeight = treeHeight * (0.2 + rng() * 0.06);
          var trunkRadius = 0.14 + rng() * 0.11;
          var trunk = document.createElement("a-entity");
          trunk.setAttribute(
            "geometry",
            "primitive: cylinder; radius: " +
              trunkRadius.toFixed(3) +
              "; height: " +
              trunkHeight.toFixed(2) +
              "; segmentsRadial: 8",
          );
          trunk.setAttribute(
            "material",
            "color: #634323; roughness: 1; metalness: 0",
          );
          trunk.setAttribute(
            "position",
            "0 " + (trunkHeight * 0.5).toFixed(2) + " 0",
          );
          trunk.setAttribute("shadow", "cast: true; receive: true");
          tree.appendChild(trunk);
        }

        for (var c = 0; c < 3; c++) {
          var card = document.createElement("a-entity");
          card.setAttribute(
            "geometry",
            "primitive: plane; width: " +
              treeWidth.toFixed(2) +
              "; height: " +
              treeHeight.toFixed(2),
          );
          card.setAttribute(
            "material",
            "src: " +
              treeTextureSelector +
              "; color: " +
              treeTint +
              "; transparent: true; alphaTest: 0.43; side: double; roughness: 1; metalness: 0",
          );
          card.setAttribute(
            "position",
            "0 " + (treeHeight * 0.5).toFixed(2) + " 0",
          );
          card.setAttribute(
            "rotation",
            "0 " + (c * 60 + (rng() * 9 - 4.5)).toFixed(2) + " 0",
          );
          card.setAttribute("shadow", "cast: true; receive: true");
          tree.appendChild(card);
        }

        fragment.appendChild(tree);
      };

      var placed = 0;
      var attempts = 0;
      var maxAttempts = Math.max(this.data.treeCount * 35, 3000);
      while (placed < this.data.treeCount && attempts < maxAttempts) {
        attempts++;
        var x = (rng() * 2 - 1) * maxRadius;
        var z = minZ + Math.pow(rng(), 0.42) * (maxZ - minZ);
        if (x * x + z * z > maxRadiusSq) {
          continue;
        }
        if (
          Math.abs(x) < this.data.centerClearWidth * 0.5 &&
          z < this.data.centerClearZ
        ) {
          continue;
        }

        appendTree({ x: x, z: z }, 5.4, 8.9, nearTintPalette, 0.82);
        placed++;
      }

      var edgeCount = Math.max(0, this.data.edgeCount);
      var startAngle = THREE.MathUtils.degToRad(40);
      var endAngle = THREE.MathUtils.degToRad(140);
      for (var i = 0; i < edgeCount; i++) {
        var t = edgeCount <= 1 ? 0.5 : i / (edgeCount - 1);
        var angle =
          startAngle + t * (endAngle - startAngle) + (rng() * 0.035 - 0.0175);
        var radius = maxRadius - (0.6 + rng() * 2.4);
        var point = {
          x: Math.cos(angle) * radius,
          z: Math.sin(angle) * radius,
        };
        if (point.z < minZ + 1) {
          continue;
        }
        appendTree(point, 7.1, 11.3, farTintPalette, 0.55);
      }

      this.el.appendChild(fragment);
    },
  });

  // Global day/night visual state management (sky, fog, key lights, ocean tint).
  AFRAME.registerComponent("day-night-cycle", {
    init: function () {
      this.mode = "day";
      this.skyEl = document.querySelector("#sky");
      this.sunEl = document.querySelector("#sunLight");
      this.sunVisualEl = document.querySelector("#sunVisual");
      this.ambientEl = document.querySelector("#ambientLight");
      this.fillEl = document.querySelector("#fillLight");
      this.oceanEl = document.querySelector("#ocean > a-entity");
      this.applyMode("day");
    },

    setLight: function (el, patch) {
      if (!el) {
        return;
      }
      var current = el.getAttribute("light");
      if (!current) {
        return;
      }
      Object.keys(patch).forEach(function (key) {
        current[key] = patch[key];
      });
      el.setAttribute("light", current);
    },

    applyMode: function (mode) {
      var isDay = mode !== "night";
      this.mode = isDay ? "day" : "night";

      if (this.skyEl) {
        this.skyEl.setAttribute("color", isDay ? "#8ccfff" : "#0f1f3b");
      }

      if (this.sunVisualEl) {
        this.sunVisualEl.setAttribute("visible", isDay);
      }

      this.el.setAttribute(
        "fog",
        "type: exponential; color: " +
          (isDay ? "#9ed3f7" : "#111f35") +
          "; density: " +
          (isDay ? "0.0038" : "0.0055"),
      );

      this.setLight(this.sunEl, {
        color: isDay ? "#fff4d4" : "#8aa8d8",
        intensity: isDay ? 1.12 : 0.2,
      });
      this.setLight(this.ambientEl, {
        color: isDay ? "#cfe8ff" : "#8ea7cc",
        intensity: isDay ? 0.58 : 0.26,
      });
      this.setLight(this.fillEl, {
        color: isDay ? "#8cb9ff" : "#5673a2",
        groundColor: isDay ? "#6e8d5a" : "#21301f",
        intensity: isDay ? 0.42 : 0.3,
      });

      if (this.oceanEl) {
        var oceanMat = this.oceanEl.getAttribute("material");
        oceanMat.color = isDay ? "#62bce8" : "#1d4f7a";
        oceanMat.opacity = isDay ? 0.95 : 0.9;
        this.oceanEl.setAttribute("material", oceanMat);
      }
    },

    toggle: function () {
      this.applyMode(this.mode === "day" ? "night" : "day");
    },
  });

  // Click handler that toggles the day/night component and UI label.
  AFRAME.registerComponent("toggle-day-night", {
    schema: {
      target: { type: "selector" },
      label: { type: "selector" },
    },

    init: function () {
      this.onClick = this.onClick.bind(this);
      this.el.addEventListener("click", this.onClick);
      this.refreshLabel();
    },

    remove: function () {
      this.el.removeEventListener("click", this.onClick);
    },

    onClick: function () {
      var target = this.data.target || this.el.sceneEl;
      if (!target || !target.components["day-night-cycle"]) {
        return;
      }
      target.components["day-night-cycle"].toggle();
      this.refreshLabel();
    },

    refreshLabel: function () {
      if (!this.data.label) {
        return;
      }
      var target = this.data.target || this.el.sceneEl;
      var mode =
        target && target.components["day-night-cycle"]
          ? target.components["day-night-cycle"].mode
          : "day";
      this.data.label.setAttribute(
        "value",
        mode === "day" ? "Mode: Day" : "Mode: Night",
      );
    },
  });

  // Bulk toggle helper for grouped point lights and their emissive indicators.
  AFRAME.registerComponent("toggle-light-group", {
    schema: {
      targets: { type: "string", default: "" },
      indicators: { type: "string", default: "" },
      label: { type: "selector" },
    },

    init: function () {
      var scene = this.el.sceneEl;
      this.lightEls = this.data.targets
        ? Array.prototype.slice.call(scene.querySelectorAll(this.data.targets))
        : [];
      this.indicatorEls = this.data.indicators
        ? Array.prototype.slice.call(
            scene.querySelectorAll(this.data.indicators),
          )
        : [];
      this.defaultIntensity = new Map();
      this.isOn = true;

      for (var i = 0; i < this.lightEls.length; i++) {
        var lightComp = this.lightEls[i].getAttribute("light");
        this.defaultIntensity.set(
          this.lightEls[i],
          lightComp && typeof lightComp.intensity === "number"
            ? lightComp.intensity
            : 1,
        );
      }

      this.onClick = this.onClick.bind(this);
      this.el.addEventListener("click", this.onClick);
      this.refreshVisuals();
    },

    remove: function () {
      this.el.removeEventListener("click", this.onClick);
    },

    onClick: function () {
      this.isOn = !this.isOn;

      for (var i = 0; i < this.lightEls.length; i++) {
        var target = this.lightEls[i];
        var lightData = target.getAttribute("light");
        if (!lightData) {
          continue;
        }
        lightData.intensity = this.isOn ? this.defaultIntensity.get(target) : 0;
        target.setAttribute("light", lightData);
      }

      this.refreshVisuals();
    },

    refreshVisuals: function () {
      for (var i = 0; i < this.indicatorEls.length; i++) {
        this.indicatorEls[i].setAttribute(
          "material",
          "color: #ffd187; emissive: " +
            (this.isOn ? "#f5b460" : "#1f1f1f") +
            "; emissiveIntensity: " +
            (this.isOn ? 0.85 : 0.08) +
            "; roughness: 0.4",
        );
      }

      if (this.data.label) {
        this.data.label.setAttribute(
          "value",
          this.isOn ? "Dock: On" : "Dock: Off",
        );
      }
    },
  });

  // Ensures transmissive model materials remain visible in this rendering setup.
  AFRAME.registerComponent("force-opaque-materials", {
    schema: {
      transmission: { type: "number", default: 0 },
      opacity: { type: "number", default: 1 },
    },

    init: function () {
      this.apply = this.apply.bind(this);
      this.el.addEventListener("model-loaded", this.apply);
    },

    update: function () {
      this.apply();
    },

    apply: function () {
      var meshRoot = this.el.getObject3D("mesh");
      if (!meshRoot) {
        return;
      }

      var transmission = this.data.transmission;
      var opacity = this.data.opacity;

      meshRoot.traverse(function (obj) {
        if (!obj.isMesh || !obj.material) {
          return;
        }

        var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (var i = 0; i < mats.length; i++) {
          var mat = mats[i];
          if (!mat) {
            continue;
          }

          if ("transmission" in mat) {
            mat.transmission = transmission;
          }
          if ("opacity" in mat) {
            mat.opacity = opacity;
          }
          mat.transparent = false;
          mat.depthWrite = true;
          if ("alphaTest" in mat) {
            mat.alphaTest = 0;
          }
          mat.needsUpdate = true;
        }
      });
    },

    remove: function () {
      this.el.removeEventListener("model-loaded", this.apply);
    },
  });
})();
