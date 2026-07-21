// shadcn/ui 的工具函数
// cn 用来合并 Tailwind 类名，解决冲突（后面的类覆盖前面的）
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
