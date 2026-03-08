import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const MILLION = 1000000;
const THOUSAND = 1000;

export function formatNumber(num: number): string {
  if (num >= MILLION) {
    return (num / MILLION).toFixed(1) + 'M'
  }
  if (num >= THOUSAND) {
    return (num / THOUSAND).toFixed(1) + 'K'
  }
  return num.toLocaleString()
}

export function formatPercentage(percent: number): string {
  return `${percent.toFixed(1)}%`
}
