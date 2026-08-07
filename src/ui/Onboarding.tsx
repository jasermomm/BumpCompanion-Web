import { CarFront, LockKeyhole, Navigation, Smartphone, type LucideIcon } from 'lucide-react';
import { Button } from './Common';

interface OnboardingPage {
  title: string;
  body: string;
  icon: LucideIcon;
}

const ONBOARDING_PAGES: ReadonlyArray<OnboardingPage> = [
  {
    title: 'Runs while visible',
    body: 'Keep BumpCompanion open and your iPhone unlocked during every drive. iOS pauses browser sensors when another app is in front.',
    icon: Navigation
  },
  {
    title: 'Mount the phone securely',
    body: 'Secure the phone in a stable mount. Detection is less reliable when the phone is loose or handheld.',
    icon: Smartphone
  },
  {
    title: 'Review after driving',
    body: 'Review possible bumps after you park. No response is needed while driving.',
    icon: CarFront
  },
  {
    title: 'Private by default',
    body: 'No account or automatic uploads. Data stays on this device unless you export it.',
    icon: LockKeyhole
  }
];

export interface OnboardingProps {
  pageIndex: number;
  onPageChange: (page: number) => void;
  onComplete: () => void;
  onSkip?: () => void;
}

export function Onboarding({ pageIndex, onPageChange, onComplete, onSkip }: OnboardingProps) {
  const safeIndex = Math.min(Math.max(0, pageIndex), ONBOARDING_PAGES.length - 1);
  const page = ONBOARDING_PAGES[safeIndex];
  const PageIcon = page.icon;
  const finalPage = safeIndex === ONBOARDING_PAGES.length - 1;

  return (
    <main className="bc-onboarding">
      <header className="bc-onboarding__header">
        <strong>BumpCompanion</strong>
        <button type="button" className="bc-text-button" onClick={onSkip ?? onComplete}>Skip</button>
      </header>
      <div className="bc-onboarding__content" aria-live="polite">
        <div className="bc-onboarding__icon"><PageIcon aria-hidden="true" size={80} strokeWidth={1.7} /></div>
        <h1>{page.title}</h1>
        <p>{page.body}</p>
      </div>
      <footer className="bc-onboarding__footer">
        <div className="bc-page-indicator" aria-label={`Page ${safeIndex + 1} of ${ONBOARDING_PAGES.length}`}>
          {ONBOARDING_PAGES.map((item, index) => (
            <span key={item.title} className={index === safeIndex ? 'is-current' : undefined} aria-hidden="true" />
          ))}
        </div>
        <div className="bc-onboarding__buttons">
          {safeIndex > 0 ? (
            <Button tone="outline" onClick={() => onPageChange(safeIndex - 1)}>Back</Button>
          ) : <span />}
          <Button onClick={() => finalPage ? onComplete() : onPageChange(safeIndex + 1)}>
            {finalPage ? 'Get started' : 'Next'}
          </Button>
        </div>
      </footer>
    </main>
  );
}
