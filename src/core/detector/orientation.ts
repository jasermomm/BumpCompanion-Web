import type { TransformedAcceleration } from './types';

export const STANDARD_GRAVITY = 9.80665;

/** Device-to-earth transform matching Android's rotation-matrix/gravity fallback behavior. */
export class OrientationEstimator {
  private rotationMatrix = new Array<number>(9).fill(0);
  private previousRotationMatrix = new Array<number>(9).fill(0);
  private hasRotationMatrix = false;
  private hasPreviousRotationMatrix = false;
  private gravityX = 0;
  private gravityY = 0;
  private gravityZ = STANDARD_GRAVITY;
  private orientationChange = 0;

  updateRotationMatrix(matrix: ArrayLike<number>): void {
    if (matrix.length < 9) return;
    if (this.hasRotationMatrix) {
      this.previousRotationMatrix = [...this.rotationMatrix];
      this.hasPreviousRotationMatrix = true;
    }
    this.rotationMatrix = Array.from(matrix).slice(0, 9);
    this.hasRotationMatrix = true;
    if (this.hasPreviousRotationMatrix) {
      let trace = 0;
      for (let row = 0; row < 3; row += 1) {
        let dot = 0;
        for (let column = 0; column < 3; column += 1) {
          dot +=
            this.rotationMatrix[row * 3 + column] *
            this.previousRotationMatrix[row * 3 + column];
        }
        trace += dot;
      }
      this.orientationChange = Math.acos(Math.min(1, Math.max(-1, (trace - 1) * 0.5)));
    }
  }

  updateGravity(x: number, y: number, z: number): void {
    this.gravityX = x;
    this.gravityY = y;
    this.gravityZ = z;
  }

  updateOrientationVector(x: number, y: number, z: number): void {
    // Retained for parity with the Android replay API. Matrix deltas are authoritative.
    void x;
    void y;
    void z;
  }

  transform(ax: number, ay: number, az: number): TransformedAcceleration {
    if (this.hasRotationMatrix) {
      const worldEast =
        this.rotationMatrix[0] * ax + this.rotationMatrix[1] * ay + this.rotationMatrix[2] * az;
      const worldNorth =
        this.rotationMatrix[3] * ax + this.rotationMatrix[4] * ay + this.rotationMatrix[5] * az;
      const worldUp =
        this.rotationMatrix[6] * ax + this.rotationMatrix[7] * ay + this.rotationMatrix[8] * az;
      const horizontalMagnitude = Math.sqrt(worldEast * worldEast + worldNorth * worldNorth);
      return {
        vertical: worldUp - STANDARD_GRAVITY,
        longitudinal: 0,
        lateral: horizontalMagnitude,
        worldEast,
        worldNorth,
        orientationChange: this.orientationChange,
        reliable: true
      };
    }

    const gravityMagnitude = Math.max(
      0.001,
      Math.sqrt(
        this.gravityX * this.gravityX + this.gravityY * this.gravityY + this.gravityZ * this.gravityZ
      )
    );
    const ux = this.gravityX / gravityMagnitude;
    const uy = this.gravityY / gravityMagnitude;
    const uz = this.gravityZ / gravityMagnitude;
    const vertical = ax * ux + ay * uy + az * uz - gravityMagnitude;
    const linearX = ax - this.gravityX;
    const linearY = ay - this.gravityY;
    const linearZ = az - this.gravityZ;
    const horizontalSquare = Math.max(
      0,
      linearX * linearX + linearY * linearY + linearZ * linearZ - vertical * vertical
    );
    return {
      vertical,
      longitudinal: 0,
      lateral: Math.sqrt(horizontalSquare),
      worldEast: Number.NaN,
      worldNorth: Number.NaN,
      orientationChange: this.orientationChange,
      reliable: false
    };
  }
}

/** Web DeviceMotion rotationRate is degrees/s; the detector expects radians/s. */
export function browserRotationRateToRadians(rotationRate: {
  alpha?: number | null;
  beta?: number | null;
  gamma?: number | null;
} | null): { x: number; y: number; z: number } {
  const radians = Math.PI / 180;
  return {
    x: (rotationRate?.beta ?? 0) * radians,
    y: (rotationRate?.gamma ?? 0) * radians,
    z: (rotationRate?.alpha ?? 0) * radians
  };
}

/** W3C DeviceOrientation Z-X'-Y'' Euler angles to a row-major device-to-world matrix. */
export function rotationMatrixFromDeviceOrientation(
  alphaDegrees: number,
  betaDegrees: number,
  gammaDegrees: number
): number[] {
  const alpha = (alphaDegrees * Math.PI) / 180;
  const beta = (betaDegrees * Math.PI) / 180;
  const gamma = (gammaDegrees * Math.PI) / 180;
  const cZ = Math.cos(alpha);
  const sZ = Math.sin(alpha);
  const cX = Math.cos(beta);
  const sX = Math.sin(beta);
  const cY = Math.cos(gamma);
  const sY = Math.sin(gamma);
  return [
    cZ * cY - sZ * sX * sY,
    -cX * sZ,
    cY * sZ * sX + cZ * sY,
    cY * sZ + cZ * sX * sY,
    cZ * cX,
    sZ * sY - cZ * cY * sX,
    -cX * sY,
    sX,
    cX * cY
  ];
}
