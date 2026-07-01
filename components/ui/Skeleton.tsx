export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700/50 ${className}`} />;
}
export default Skeleton;
