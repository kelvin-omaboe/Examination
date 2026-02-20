(function () {
  if (AFRAME.components["water-surface"]) {
    return;
  }

  // Animates plane-like meshes to simulate moving water with low per-frame cost.
  AFRAME.registerComponent("water-surface", {
    schema: {
      amplitude: { type: "number", default: 0.2 },
      frequency: { type: "number", default: 0.14 },
      speed: { type: "number", default: 0.45 },
      uvSpeedX: { type: "number", default: 0.006 },
      uvSpeedY: { type: "number", default: 0.003 },
    },

    init: function () {
      this.mesh = null;
      this.positionAttr = null;
      this.basePositions = null;
      this.frame = 0;
      this.onMeshSet = this.onMeshSet.bind(this);

      this.el.addEventListener("object3dset", this.onMeshSet);
      this.onMeshSet();
    },

    onMeshSet: function (evt) {
      if (evt && evt.detail.type !== "mesh") {
        return;
      }

      var mesh = this.el.getObject3D("mesh");
      if (
        !mesh ||
        !mesh.geometry ||
        !mesh.geometry.attributes ||
        !mesh.geometry.attributes.position
      ) {
        return;
      }

      this.mesh = mesh;
      this.positionAttr = mesh.geometry.attributes.position;
      this.basePositions = new Float32Array(this.positionAttr.array);

      if (mesh.material && mesh.material.map) {
        // Keep UVs tileable so scrolling normal maps remain seamless.
        mesh.material.map.wrapS = THREE.RepeatWrapping;
        mesh.material.map.wrapT = THREE.RepeatWrapping;
        mesh.material.map.needsUpdate = true;
      }
    },

    tick: function (time, deltaMs) {
      if (!this.positionAttr || !this.basePositions || !this.mesh) {
        return;
      }

      var pos = this.positionAttr.array;
      var base = this.basePositions;
      var t = time * 0.001 * this.data.speed;
      var freq = this.data.frequency;
      var amp = this.data.amplitude;

      // Blend several waves for a less repetitive surface profile.
      for (var i = 0; i < pos.length; i += 3) {
        var x = base[i];
        var y = base[i + 1];

        var waveA = Math.sin(x * freq + t * 2.1);
        var waveB = Math.cos(y * (freq * 1.6) + t * 1.35);
        var waveC = Math.sin((x + y) * (freq * 0.42) + t * 2.85);
        pos[i + 2] = base[i + 2] + (waveA + waveB * 0.72 + waveC * 0.36) * amp;
      }

      this.positionAttr.needsUpdate = true;
      // Recompute normals less frequently for steadier framerate.
      if ((this.frame++ & 15) === 0) {
        this.mesh.geometry.computeVertexNormals();
      }

      if (this.mesh.material && this.mesh.material.map) {
        var deltaSec = deltaMs * 0.001;
        var map = this.mesh.material.map;
        map.offset.x = (map.offset.x + this.data.uvSpeedX * deltaSec) % 1;
        map.offset.y = (map.offset.y + this.data.uvSpeedY * deltaSec) % 1;
      }
    },

    remove: function () {
      this.el.removeEventListener("object3dset", this.onMeshSet);
    },
  });

  // Fits imported glTF models to target dimensions while preserving proportions.
  AFRAME.registerComponent("model-autofit", {
    schema: {
      width: { type: "number", default: 0 },
      depth: { type: "number", default: 0 },
      height: { type: "number", default: 0 },
      centerX: { type: "boolean", default: true },
      centerZ: { type: "boolean", default: true },
      alignGround: { type: "boolean", default: true },
      groundOffset: { type: "number", default: 0 },
    },

    init: function () {
      this.hasBaseTransform = false;
      this.basePosition = new THREE.Vector3();
      this.baseScale = new THREE.Vector3(1, 1, 1);

      this.fit = this.fit.bind(this);
      this.el.addEventListener("model-loaded", this.fit);
    },

    update: function () {
      this.fit();
    },

    fit: function () {
      var mesh = this.el.getObject3D("mesh");
      if (!mesh) {
        return;
      }

      if (!this.hasBaseTransform) {
        this.basePosition.copy(mesh.position);
        this.baseScale.copy(mesh.scale);
        this.hasBaseTransform = true;
      }

      mesh.position.copy(this.basePosition);
      mesh.scale.copy(this.baseScale);
      mesh.updateMatrixWorld(true);

      var initialBox = new THREE.Box3().setFromObject(mesh);
      if (initialBox.isEmpty()) {
        return;
      }

      var initialSize = new THREE.Vector3();
      initialBox.getSize(initialSize);

      var scaleCandidates = [];
      if (this.data.width > 0 && initialSize.x > 0) {
        scaleCandidates.push(this.data.width / initialSize.x);
      }
      if (this.data.height > 0 && initialSize.y > 0) {
        scaleCandidates.push(this.data.height / initialSize.y);
      }
      if (this.data.depth > 0 && initialSize.z > 0) {
        scaleCandidates.push(this.data.depth / initialSize.z);
      }

      // Use the smallest candidate so the model always fits inside requested bounds.
      var uniformScale = scaleCandidates.length
        ? Math.min.apply(Math, scaleCandidates)
        : 1;
      mesh.scale.multiplyScalar(uniformScale);
      mesh.updateMatrixWorld(true);

      var fittedBox = new THREE.Box3().setFromObject(mesh);
      var centerWorld = new THREE.Vector3();
      fittedBox.getCenter(centerWorld);
      var centerLocal = this.el.object3D.worldToLocal(centerWorld.clone());

      if (this.data.centerX) {
        mesh.position.x -= centerLocal.x;
      }
      if (this.data.centerZ) {
        mesh.position.z -= centerLocal.z;
      }
      if (this.data.alignGround) {
        var groundProbeWorld = new THREE.Vector3(
          centerWorld.x,
          fittedBox.min.y,
          centerWorld.z,
        );
        var groundProbeLocal = this.el.object3D.worldToLocal(groundProbeWorld);
        mesh.position.y -= groundProbeLocal.y;
      }
      if (this.data.groundOffset !== 0) {
        mesh.position.y += this.data.groundOffset;
      }

      mesh.updateMatrixWorld(true);

      this.el.emit("model-autofit-complete");
    },

    remove: function () {
      this.el.removeEventListener("model-loaded", this.fit);
    },
  });

  // Adds a dynamic water plane on top of pool models and softens baked water materials.
  AFRAME.registerComponent("pool-water-overlay", {
    schema: {
      color: { type: "color", default: "#55c8f2" },
      opacity: { type: "number", default: 0.8 },
      roughness: { type: "number", default: 0.14 },
      metalness: { type: "number", default: 0.08 },
      waterHeightOffset: { type: "number", default: 0.03 },
      segments: { type: "int", default: 60 },
    },

    init: function () {
      this.waterEl = null;
      this.pendingBuild = null;
      this.buildWater = this.buildWater.bind(this);
      this.queueBuild = this.queueBuild.bind(this);

      this.el.addEventListener("model-loaded", this.queueBuild);
      this.el.addEventListener("model-autofit-complete", this.queueBuild);
    },

    update: function () {
      this.queueBuild();
    },

    queueBuild: function () {
      if (this.pendingBuild) {
        cancelAnimationFrame(this.pendingBuild);
      }
      // Delay rebuild to next frame so model/autofit updates settle first.
      this.pendingBuild = requestAnimationFrame(this.buildWater);
    },

    softenPoolMeshMaterial: function (obj3d) {
      if (!obj3d.material) {
        return;
      }

      var materials = Array.isArray(obj3d.material)
        ? obj3d.material
        : [obj3d.material];
      for (var i = 0; i < materials.length; i++) {
        var mat = materials[i];
        if (!mat) {
          continue;
        }
        mat.transparent = true;
        mat.opacity = Math.min(
          typeof mat.opacity === "number" ? mat.opacity : 1,
          0.15,
        );
        mat.depthWrite = false;
        if (mat.color) {
          mat.color.set("#77d0f2");
        }
        mat.needsUpdate = true;
      }
    },

    buildWater: function () {
      this.pendingBuild = null;

      var meshRoot = this.el.getObject3D("mesh");
      if (!meshRoot) {
        return;
      }

      if (this.waterEl && this.waterEl.parentNode) {
        this.waterEl.parentNode.removeChild(this.waterEl);
      }
      this.waterEl = null;

      var waterMeshes = [];
      meshRoot.traverse(function (obj) {
        if (!obj.isMesh) {
          return;
        }
        var name = (obj.name || "").toLowerCase();
        if (name.indexOf("water") !== -1 || name.indexOf("inwater") !== -1) {
          waterMeshes.push(obj);
        }
      });

      var bounds = new THREE.Box3();
      if (waterMeshes.length > 0) {
        for (var i = 0; i < waterMeshes.length; i++) {
          bounds.expandByObject(waterMeshes[i]);
          this.softenPoolMeshMaterial(waterMeshes[i]);
        }
      } else {
        bounds.setFromObject(meshRoot);
      }

      if (bounds.isEmpty()) {
        return;
      }

      var size = new THREE.Vector3();
      var centerWorld = new THREE.Vector3();
      bounds.getSize(size);
      bounds.getCenter(centerWorld);

      var centerLocal = this.el.object3D.worldToLocal(centerWorld.clone());
      var width = Math.max(size.x * 0.94, 0.6);
      var depth = Math.max(size.z * 0.94, 0.6);
      // Position water slightly below the top edge to avoid clipping/flicker.
      var waterY = centerLocal.y + size.y * 0.48 + this.data.waterHeightOffset;

      var waterEl = document.createElement("a-entity");
      waterEl.setAttribute(
        "geometry",
        "primitive: plane; width: " +
          width.toFixed(3) +
          "; height: " +
          depth.toFixed(3) +
          "; segmentsWidth: " +
          this.data.segments +
          "; segmentsHeight: " +
          this.data.segments,
      );
      waterEl.setAttribute("rotation", "-90 0 0");
      waterEl.setAttribute(
        "position",
        centerLocal.x.toFixed(3) +
          " " +
          waterY.toFixed(3) +
          " " +
          centerLocal.z.toFixed(3),
      );
      waterEl.setAttribute(
        "material",
        "normalMap: #waterNormals; normalTextureRepeat: 6 6; color: " +
          this.data.color +
          "; roughness: " +
          this.data.roughness +
          "; metalness: " +
          this.data.metalness +
          "; transparent: true; opacity: " +
          this.data.opacity +
          "; side: double",
      );
      waterEl.setAttribute(
        "water-surface",
        "amplitude: 0.035; frequency: 2.6; speed: 1.08; uvSpeedX: 0.03; uvSpeedY: 0.02",
      );
      waterEl.setAttribute("shadow", "receive: true");

      this.el.appendChild(waterEl);
      this.waterEl = waterEl;
    },

    remove: function () {
      this.el.removeEventListener("model-loaded", this.queueBuild);
      this.el.removeEventListener("model-autofit-complete", this.queueBuild);

      if (this.pendingBuild) {
        cancelAnimationFrame(this.pendingBuild);
        this.pendingBuild = null;
      }

      if (this.waterEl && this.waterEl.parentNode) {
        this.waterEl.parentNode.removeChild(this.waterEl);
      }
      this.waterEl = null;
    },
  });
})();
