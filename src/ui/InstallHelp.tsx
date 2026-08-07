import { ExternalLink, Share, Smartphone } from 'lucide-react';
import { Button, Dialog, InlineNotice } from './Common';

export interface InstallHelpProps {
  open: boolean;
  onDismiss: () => void;
}
export function InstallHelp({ open, onDismiss }: InstallHelpProps) {
  return (
    <Dialog
      open={open}
      title="Install on iPhone"
      icon={Smartphone}
      variant="sheet"
      onDismiss={onDismiss}
      actions={<Button onClick={onDismiss}>Done</Button>}
    >
      <ol className="bc-install-steps">
        <li><span>1</span><p>Open this website in <strong>Safari</strong>.</p><ExternalLink aria-hidden="true" size={20} /></li>
        <li><span>2</span><p>Tap the <strong>Share</strong> button.</p><Share aria-hidden="true" size={20} /></li>
        <li><span>3</span><p>Scroll down and tap <strong>Add to Home Screen</strong>.</p></li>
        <li><span>4</span><p>Launch <strong>BumpCompanion</strong> from your Home Screen.</p></li>
        <li><span>5</span><p>Press <strong>Start Drive</strong>.</p></li>
        <li><span>6</span><p>Allow Motion and precise Location access.</p></li>
      </ol>
      <InlineNotice tone="info">
        Keep BumpCompanion open and your iPhone unlocked during a drive. iOS pauses browser sensor access in the background.
      </InlineNotice>
    </Dialog>
  );
}
