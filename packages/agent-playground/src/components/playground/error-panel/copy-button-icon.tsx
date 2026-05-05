import { Check, Copy } from 'lucide-react';

interface ICopyButtonIconProps {
  isCopied: boolean;
  className: string;
}

export function CopyButtonIcon({ isCopied, className }: ICopyButtonIconProps) {
  const Icon = isCopied ? Check : Copy;
  return <Icon className={className} />;
}
