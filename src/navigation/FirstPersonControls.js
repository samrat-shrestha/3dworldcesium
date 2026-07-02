import * as Cesium from 'cesium';

/**
 * FirstPersonControls — WASD + mouse-look first-person camera navigation.
 *
 * Uses Cesium's own ScreenSpaceEventHandler for mouse look (right-drag)
 * to avoid event conflicts with Cesium's internal event system.
 *
 * Controls:
 *   W/S — Forward / Backward
 *   A/D — Strafe left / right
 *   Q/E — Up / Down
 *   Right-click drag — Look around (pan + tilt)
 *   Shift — Sprint (3x speed)
 */
export class FirstPersonControls {
  constructor(viewer) {
    this.viewer = viewer;
    this.enabled = false;

    this._keys = {};
    this._moveSpeed = 2.0;
    this._sprintMultiplier = 3.0;
    this._lookSpeed = 0.003;

    // Mouse look state
    this._isLooking = false;
    this._lastMouseX = 0;
    this._lastMouseY = 0;

    // Cesium event handler for mouse look (created on enable)
    this._mouseHandler = null;

    // Bound keyboard handlers
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);

    this._postUpdateRemover = null;
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;

    // Disable Cesium's default camera controls
    const controller = this.viewer.scene.screenSpaceCameraController;
    controller.enableRotate = false;
    controller.enableTranslate = false;
    controller.enableZoom = false;
    controller.enableTilt = false;
    controller.enableLook = false;

    // Keyboard on document
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);

    // Use Cesium's OWN event system for mouse — this avoids all event conflicts
    this._mouseHandler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

    // Right button down → start looking
    this._mouseHandler.setInputAction((movement) => {
      this._isLooking = true;
      this._lastMouseX = movement.position.x;
      this._lastMouseY = movement.position.y;
      this.viewer.canvas.style.cursor = 'none';
    }, Cesium.ScreenSpaceEventType.RIGHT_DOWN);

    // Right button up → stop looking
    this._mouseHandler.setInputAction(() => {
      this._isLooking = false;
      this.viewer.canvas.style.cursor = 'crosshair';
    }, Cesium.ScreenSpaceEventType.RIGHT_UP);

    // Mouse move → apply rotation when looking
    this._mouseHandler.setInputAction((movement) => {
      if (!this._isLooking) return;

      const dx = movement.endPosition.x - movement.startPosition.x;
      const dy = movement.endPosition.y - movement.startPosition.y;

      const camera = this.viewer.camera;
      camera.setView({
        orientation: {
          heading: camera.heading - dx * this._lookSpeed,
          pitch: Cesium.Math.clamp(
            camera.pitch - dy * this._lookSpeed,
            Cesium.Math.toRadians(-89),
            Cesium.Math.toRadians(89)
          ),
          roll: 0,
        },
      });
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // Per-frame update for WASD movement
    this._postUpdateRemover = this.viewer.scene.postUpdate.addEventListener(
      this._update.bind(this)
    );

    // Drop camera to street level if too high
    const cameraHeight = this._getCameraHeight();
    if (cameraHeight > 50) {
      const cartographic = Cesium.Cartographic.fromCartesian(this.viewer.camera.position);
      this.viewer.camera.setView({
        destination: Cesium.Cartesian3.fromRadians(
          cartographic.longitude,
          cartographic.latitude,
          20
        ),
        orientation: {
          heading: this.viewer.camera.heading,
          pitch: Cesium.Math.toRadians(-5),
          roll: 0,
        },
      });
    }

    this.viewer.canvas.style.cursor = 'crosshair';
    console.log('[HydroViz] Walk mode ON — right-click drag to look, WASD to move');
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;

    // Restore Cesium's camera controls
    const controller = this.viewer.scene.screenSpaceCameraController;
    controller.enableRotate = true;
    controller.enableTranslate = true;
    controller.enableZoom = true;
    controller.enableTilt = true;
    controller.enableLook = true;

    // Remove keyboard
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);

    // Destroy Cesium mouse handler
    if (this._mouseHandler) {
      this._mouseHandler.destroy();
      this._mouseHandler = null;
    }

    // Remove per-frame update
    if (this._postUpdateRemover) {
      this._postUpdateRemover();
      this._postUpdateRemover = null;
    }

    this._keys = {};
    this._isLooking = false;
    this.viewer.canvas.style.cursor = '';

    console.log('[HydroViz] Walk mode OFF');
  }

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
    return this.enabled;
  }

  setSpeed(speed) {
    this._moveSpeed = speed;
  }

  _getCameraHeight() {
    try {
      return Cesium.Cartographic.fromCartesian(this.viewer.camera.position).height;
    } catch {
      return 100;
    }
  }

  _handleKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    this._keys[e.key.toLowerCase()] = true;
  }

  _handleKeyUp(e) {
    this._keys[e.key.toLowerCase()] = false;
    if (e.key === 'Shift') this._keys['shift'] = false;
  }

  _update() {
    if (!this.enabled) return;

    const camera = this.viewer.camera;
    const sprint = this._keys['shift'] ? this._sprintMultiplier : 1.0;
    const speed = this._moveSpeed * sprint;

    // WASD — movement
    if (this._keys['w']) camera.moveForward(speed);
    if (this._keys['s']) camera.moveBackward(speed);
    if (this._keys['a']) camera.moveLeft(speed);
    if (this._keys['d']) camera.moveRight(speed);
    if (this._keys['q'] || this._keys[' ']) camera.moveUp(speed * 0.5);
    if (this._keys['e']) camera.moveDown(speed * 0.5);

    // Arrow keys — look around (so walk mode works without a mouse)
    const lookRate = Cesium.Math.toRadians(1.5) * sprint;
    let headingDelta = 0;
    let pitchDelta = 0;

    if (this._keys['arrowleft'])  headingDelta += lookRate;
    if (this._keys['arrowright']) headingDelta -= lookRate;
    if (this._keys['arrowup'])    pitchDelta += lookRate;
    if (this._keys['arrowdown'])  pitchDelta -= lookRate;

    if (headingDelta !== 0 || pitchDelta !== 0) {
      camera.setView({
        orientation: {
          heading: camera.heading + headingDelta,
          pitch: Cesium.Math.clamp(
            camera.pitch + pitchDelta,
            Cesium.Math.toRadians(-89),
            Cesium.Math.toRadians(89)
          ),
          roll: 0,
        },
      });
    }

    // Prevent roll accumulation
    if (camera.roll !== 0 && headingDelta === 0 && pitchDelta === 0) {
      camera.setView({
        orientation: { heading: camera.heading, pitch: camera.pitch, roll: 0 },
      });
    }
  }

  destroy() {
    this.disable();
  }
}
