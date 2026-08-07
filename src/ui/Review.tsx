import { ArrowLeft, Gauge } from 'lucide-react';
import {
  CandidateDecision,
  type CandidateEvent
} from '../core/models';
import { Button, EmptyState, IconButton, Screen, TopBar } from './Common';
import { formatCoordinates, formatDateTime, formatSpeed, roadEventLabel } from './formatters';

export interface ReviewScreenProps {
  candidates: CandidateEvent[];
  metricUnits: boolean;
  onBack: () => void;
  onDecision: (candidateId: string, decision: CandidateDecision) => void;
  onConfirmProbable: () => void;
}
export function ReviewScreen({
  candidates,
  metricUnits,
  onBack,
  onDecision,
  onConfirmProbable
}: ReviewScreenProps) {
  const canBatchConfirm = candidates.some((candidate) =>
    candidate.confidence >= 0.7 && candidate.latitude !== null && candidate.longitude !== null);

  return (
    <>
      <TopBar
        title="Review detections"
        leading={<IconButton label="Back" icon={ArrowLeft} onClick={onBack} />}
        actions={(
          <button
            type="button"
            className="bc-text-button bc-review-batch"
            disabled={!canBatchConfirm}
            onClick={onConfirmProbable}
          >
            Confirm likely bumps
          </button>
        )}
      />
      <Screen className="bc-review-screen">
        {candidates.length === 0 ? (
          <EmptyState
            title="Nothing to review"
            body="Review possible bumps after you park. No response is needed while driving."
            icon={Gauge}
          />
        ) : (
          <div className="bc-review-list">
            {candidates.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                metricUnits={metricUnits}
                onDecision={(decision) => onDecision(candidate.id, decision)}
              />
            ))}
          </div>
        )}
      </Screen>
    </>
  );
}

function CandidateCard({
  candidate,
  metricUnits,
  onDecision
}: {
  candidate: CandidateEvent;
  metricUnits: boolean;
  onDecision: (decision: CandidateDecision) => void;
}) {
  const hasCoordinates = candidate.latitude !== null && candidate.longitude !== null;
  return (
    <article className="bc-candidate-card">
      <header>
        <span className="bc-candidate-card__icon"><Gauge aria-hidden="true" size={23} /></span>
        <div>
          <h2>{roadEventLabel(candidate.eventType)}</h2>
          <time dateTime={new Date(candidate.detectedAt).toISOString()}>{formatDateTime(candidate.detectedAt)}</time>
        </div>
      </header>
      <p>{hasCoordinates
        ? formatCoordinates(candidate.latitude as number, candidate.longitude as number)
        : 'Unknown location'}</p>
      <p>Speed at event: {formatSpeed(candidate.speedMetresPerSecond, metricUnits)}</p>
      <div className="bc-two-column-actions">
        <Button
          disabled={!hasCoordinates}
          onClick={() => onDecision(CandidateDecision.CONFIRMED)}
        >Confirm speed bump</Button>
        <Button tone="outline" onClick={() => onDecision(CandidateDecision.REJECTED)}>Reject</Button>
      </div>
      <div className="bc-candidate-card__secondary-actions">
        <button type="button" onClick={() => onDecision(CandidateDecision.NOT_SURE)}>Not sure</button>
        <button type="button" onClick={() => onDecision(CandidateDecision.POTHOLE)}>Mark as pothole</button>
        <button type="button" onClick={() => onDecision(CandidateDecision.ROUGH_ROAD)}>Mark as rough road</button>
      </div>
    </article>
  );
}
