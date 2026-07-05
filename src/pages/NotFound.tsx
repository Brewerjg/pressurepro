import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background grid place-items-center px-6 text-center">
      <div>
        <div className="text-xs font-semibold tracking-[2px] uppercase text-accent-500 mb-2">
          404
        </div>
        <h1 className="tp-display text-2xl font-bold text-neutral-900 mb-2">
          Page not found
        </h1>
        <Link to="/" className="text-sm font-semibold text-brand-700 hover:text-brand-800">
          Back to home
        </Link>
      </div>
    </div>
  );
}
