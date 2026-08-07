import { Activity, ArrowLeft } from 'lucide-react';
import type { CalibrationProfile } from '../core/models';
import { Button, IconButton, Screen, TopBar } from './Common';
import { formatDateTime } from './formatters';

export interface CalibrationScreenProps {
  profile: CalibrationProfile | null;
  running: boolean;
  error?: string | null;
  onBack: () => void;
  onStart: () => void;
  onReset: () => void;
}

export function CalibrationScreen({ profile, running, error, onBack, onStart, onReset }: CalibrationScreenProps) {
  return (
    <>
      <TopBar
        title="Calibration"
        leading={<IconButton label="Back" icon={ArrowLeft} onClick={onBack} />}
      />
      <Screen className="bc-calibration-screen">
        <div className="bc-calibration-content">
          <div className="bc-calibration-icon"><Activity aria-hidden="true" size={66} /></div>
          <p className="bc-calibration-instructions">Keep the securely mounted phone still until the countdown finishes.</p>
          {running ? (
            <div className="bc-calibration-running" role="status">
              <span className="bc-spinner" aria-hidden="true" />
              <span>Calibrating…</span>
            </div>
          ) : (
            <Button fullWidth onClick={onStart}>{profile ? 'Recalibrate' : 'Start calibration'}</Button>
          )}
          {error ? <p className="bc-field-error" role="alert">{error}</p> : null}
          {profile ? (
            <div className="bc-calibration-complete">
              <hr className="bc-divider" />
              <h2>Calibration complete</h2>
              <p>Last calibrated: {formatDateTime(profile.createdAt)}</p>
              <button type="button" className="bc-text-button" onClick={onReset}>Reset calibration</button>
            </div>
          ) : null}
          <p className="bc-calibration-safety">
            Calibrate only while the vehicle is parked and the phone is secured in its normal mount.
          </p>
        </div>
      </Screen>
    </>
  );
}
