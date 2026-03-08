"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

const INDICATOR_TRANSLATE_CLASSES = {
    0: "-translate-x-full",
    5: "-translate-x-[95%]",
    10: "-translate-x-[90%]",
    15: "-translate-x-[85%]",
    20: "-translate-x-[80%]",
    25: "-translate-x-[75%]",
    30: "-translate-x-[70%]",
    35: "-translate-x-[65%]",
    40: "-translate-x-[60%]",
    45: "-translate-x-[55%]",
    50: "-translate-x-1/2",
    55: "-translate-x-[45%]",
    60: "-translate-x-[40%]",
    65: "-translate-x-[35%]",
    70: "-translate-x-[30%]",
    75: "-translate-x-1/4",
    80: "-translate-x-[20%]",
    85: "-translate-x-[15%]",
    90: "-translate-x-[10%]",
    95: "-translate-x-[5%]",
    100: "translate-x-0",
} as const

const PROGRESS_MAX = 100;
const PROGRESS_STEP = 5;

function getIndicatorTranslateClass(value?: number | null): string {
    const raw = typeof value === "number" ? value : 0
    const bounded = Math.max(0, Math.min(PROGRESS_MAX, raw))
    const rounded = Math.round(bounded / PROGRESS_STEP) * PROGRESS_STEP as keyof typeof INDICATOR_TRANSLATE_CLASSES
    return INDICATOR_TRANSLATE_CLASSES[rounded]
}

const Progress = React.forwardRef<
    React.ElementRef<typeof ProgressPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
    <ProgressPrimitive.Root
        ref={ref}
        className={cn(
            "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
            className
        )}
        {...props}
    >
        <ProgressPrimitive.Indicator
            className={cn(
                "h-full w-full flex-1 bg-primary transition-all duration-300",
                getIndicatorTranslateClass(value)
            )}
        />
    </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress } 
