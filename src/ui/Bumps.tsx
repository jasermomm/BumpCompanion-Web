import {
  Archive,
  BellOff,
  BellRing,
  Gauge,
  List,
  Map,
  MapPinned,
  MoreVertical,
  OctagonX,
  Pencil,
  Search,
  Trash2
} from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { BumpStatus, type GeoPoint, type SpeedBump } from '../core/models';
import { BumpMap } from './BumpMap';
import { Button, Dialog, EmptyState, Screen, TopBar } from './Common';
import { formatCoordinates, formatDateTime, formatSeenCount } from './formatters';
import { classNames } from './utils';

export type BumpsView = 'list' | 'map';

const FILTERS: ReadonlyArray<{ value: BumpStatus | null; label: string }> = [
  { value: null, label: 'All' },
  { value: BumpStatus.CONFIRMED, label: 'Confirmed' },
  { value: BumpStatus.PENDING, label: 'Pending' },
  { value: BumpStatus.IMPORTED, label: 'Imported' },
  { value: BumpStatus.ARCHIVED, label: 'Archived' },
  { value: BumpStatus.REMOVED, label: 'Removed' }
];

export interface BumpsScreenProps {
  items: SpeedBump[];
  filter: BumpStatus | null;
  search: string;
  view: BumpsView;
  selectedBump: SpeedBump | null;
  currentLocation?: GeoPoint | null;
  onFilterChange: (filter: BumpStatus | null) => void;
  onSearchChange: (search: string) => void;
  onViewChange: (view: BumpsView) => void;
  onSelectBump: (bump: SpeedBump | null) => void;
  onSaveBump: (bump: SpeedBump) => void;
  onToggleWarning: (bump: SpeedBump) => void;
  onArchive: (bump: SpeedBump) => void;
  onMarkRemoved: (bump: SpeedBump) => void;
  onDelete: (bump: SpeedBump) => void;
  onOpenExternal: (bump: SpeedBump) => void;
}

export function BumpsScreen(props: BumpsScreenProps) {
  return (
    <>
      <TopBar title="Bumps" />
      <Screen className="bc-bumps-screen">
        <div className="bc-bumps-toolbar">
          <label className="bc-search-field">
            <span className="bc-visually-hidden">Search bumps</span>
            <Search aria-hidden="true" size={20} />
            <input
              type="search"
              value={props.search}
              placeholder="Search bumps"
              onChange={(event) => props.onSearchChange(event.currentTarget.value)}
            />
          </label>
          <div className="bc-view-toggle" aria-label="Bump view">
            <button
              type="button"
              aria-pressed={props.view === 'list'}
              onClick={() => props.onViewChange('list')}
            ><List aria-hidden="true" size={19} /> List</button>
            <button
              type="button"
              aria-pressed={props.view === 'map'}
              onClick={() => props.onViewChange('map')}
            ><Map aria-hidden="true" size={19} /> Map</button>
          </div>
        </div>

        <div className="bc-filter-tabs" role="tablist" aria-label="Filter bumps">
          {FILTERS.map(({ value, label }) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={props.filter === value}
              onClick={() => props.onFilterChange(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {props.view === 'map' ? (
          <BumpMap bumps={props.items} currentLocation={props.currentLocation} onSelectBump={props.onSelectBump} />
        ) : props.items.length === 0 ? (
          <EmptyState
            title="No bumps in this view"
            body="Your bump and drive data stays on this device unless you export it."
            icon={Gauge}
          />
        ) : (
          <div className="bc-bump-list">
            {props.items.map((bump) => (
              <BumpCard
                key={bump.id}
                bump={bump}
                onEdit={() => props.onSelectBump(bump)}
                onToggleWarning={() => props.onToggleWarning(bump)}
                onArchive={() => props.onArchive(bump)}
                onMarkRemoved={() => props.onMarkRemoved(bump)}
                onDelete={() => props.onDelete(bump)}
                onOpenExternal={() => props.onOpenExternal(bump)}
              />
            ))}
          </div>
        )}
      </Screen>

      <EditBumpDialog
        bump={props.selectedBump}
        onDismiss={() => props.onSelectBump(null)}
        onSave={props.onSaveBump}
      />
    </>
  );
}

interface BumpCardProps {
  bump: SpeedBump;
  onEdit: () => void;
  onToggleWarning: () => void;
  onArchive: () => void;
  onMarkRemoved: () => void;
  onDelete: () => void;
  onOpenExternal: () => void;
}

function BumpCard({
  bump,
  onEdit,
  onToggleWarning,
  onArchive,
  onMarkRemoved,
  onDelete,
  onOpenExternal
}: BumpCardProps) {
  const title = bump.roadName ?? bump.regionLabel ?? 'Unknown location';
  return (
    <article className="bc-bump-card">
      <button type="button" className="bc-bump-card__main" onClick={onEdit}>
        <span className={classNames('bc-bump-card__icon', `status-${bump.status.toLowerCase()}`)}>
          <Gauge aria-hidden="true" size={24} />
        </span>
        <span className="bc-bump-card__copy">
          <strong>{title}</strong>
          <span>{formatCoordinates(bump.latitude, bump.longitude)}</span>
          <span>{formatSeenCount(bump.encounterCount)}</span>
          <small>Last seen: {formatDateTime(bump.lastDetectedAt)}</small>
        </span>
      </button>
      <div className="bc-bump-card__footer">
        <button type="button" className="bc-assist-chip" onClick={onToggleWarning}>
          {bump.warningEnabled ? <BellRing aria-hidden="true" size={17} /> : <BellOff aria-hidden="true" size={17} />}
          {bump.warningEnabled ? 'Warnings on' : 'Warnings off'}
        </button>
        <details className="bc-overflow-menu">
          <summary aria-label={`Actions for ${title}`}><MoreVertical aria-hidden="true" size={22} /></summary>
          <div className="bc-overflow-menu__items">
            <MenuAction icon={Pencil} label="Edit" onClick={onEdit} />
            <MenuAction icon={MapPinned} label="Open coordinate externally" onClick={onOpenExternal} />
            <MenuAction icon={Archive} label={bump.archived ? 'Confirmed' : 'Archive'} onClick={onArchive} />
            <MenuAction icon={OctagonX} label="Mark removed" onClick={onMarkRemoved} />
            <MenuAction icon={Trash2} label="Delete" onClick={onDelete} danger />
          </div>
        </details>
      </div>
    </article>
  );
}

function MenuAction({
  icon: Icon,
  label,
  onClick,
  danger = false
}: { icon: typeof Pencil; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className={danger ? 'is-danger' : undefined} onClick={onClick}>
      <Icon aria-hidden="true" size={18} /> {label}
    </button>
  );
}

interface BumpDraft {
  roadName: string;
  regionLabel: string;
  latitude: string;
  longitude: string;
  notes: string;
}

export interface EditBumpDialogProps {
  bump: SpeedBump | null;
  onDismiss: () => void;
  onSave: (bump: SpeedBump) => void;
}

export function EditBumpDialog({ bump, onDismiss, onSave }: EditBumpDialogProps) {
  const formId = useId();
  const [draft, setDraft] = useState<BumpDraft>(() => toDraft(bump));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(toDraft(bump));
    setInvalid(false);
  }, [bump]);

  const update = (key: keyof BumpDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: key === 'notes' ? value.slice(0, 2_000) : value }));
    if (key === 'latitude' || key === 'longitude') setInvalid(false);
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!bump) return;
    const latitudeText = draft.latitude.trim();
    const longitudeText = draft.longitude.trim();
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    if (!latitudeText || !longitudeText || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      setInvalid(true);
      return;
    }
    onSave({
      ...bump,
      latitude,
      longitude,
      roadName: draft.roadName.trim() || null,
      regionLabel: draft.regionLabel.trim() || null,
      notes: draft.notes
    });
  };

  return (
    <Dialog
      open={bump !== null}
      title="Edit"
      onDismiss={onDismiss}
      actions={(
        <>
          <Button tone="ghost" onClick={onDismiss}>Cancel</Button>
          <Button type="submit" form={formId}>Save</Button>
        </>
      )}
    >
      <form id={formId} className="bc-edit-form" onSubmit={submit}>
        <label>Label<input value={draft.roadName} onChange={(event) => update('roadName', event.currentTarget.value)} /></label>
        <label>Location label<input value={draft.regionLabel} onChange={(event) => update('regionLabel', event.currentTarget.value)} /></label>
        <div className="bc-form-columns">
          <label>Latitude<input inputMode="decimal" value={draft.latitude} onChange={(event) => update('latitude', event.currentTarget.value)} /></label>
          <label>Longitude<input inputMode="decimal" value={draft.longitude} onChange={(event) => update('longitude', event.currentTarget.value)} /></label>
        </div>
        <label>Notes<textarea rows={3} maxLength={2_000} value={draft.notes} onChange={(event) => update('notes', event.currentTarget.value)} /></label>
        {invalid ? <p className="bc-field-error" role="alert">Enter valid latitude and longitude values.</p> : null}
      </form>
    </Dialog>
  );
}

function toDraft(bump: SpeedBump | null): BumpDraft {
  return {
    roadName: bump?.roadName ?? '',
    regionLabel: bump?.regionLabel ?? '',
    latitude: bump ? String(bump.latitude) : '',
    longitude: bump ? String(bump.longitude) : '',
    notes: bump?.notes ?? ''
  };
}
