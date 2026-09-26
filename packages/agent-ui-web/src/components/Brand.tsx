/** robota's mark: a rounded face with two eyes, in the accent colour. */
export function RobotaMark({ size = 20 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="flex-shrink-0"
    >
      <rect x="1" y="2.5" width="18" height="15" rx="5.5" className="fill-accent" />
      <circle cx="7.2" cy="10" r="1.7" className="fill-accent-foreground" />
      <circle cx="12.8" cy="10" r="1.7" className="fill-accent-foreground" />
    </svg>
  );
}

/** The mark and the wordmark, as the app's name in its chrome. */
export function RobotaWordmark({ surface }: { surface?: string }): React.ReactElement {
  return (
    <span className="flex items-center gap-2">
      <RobotaMark />
      <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">robota</span>
      {surface ? (
        <span className="rounded-md bg-raised px-1.5 py-px text-[11px] font-medium text-muted-foreground">
          {surface}
        </span>
      ) : null}
    </span>
  );
}
