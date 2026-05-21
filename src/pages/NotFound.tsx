import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background grid place-items-center px-6 text-center">
      <div>
        <div className="text-xs font-semibold tracking-[2px] uppercase text-bronze-500 mb-2">
          404
        </div>
        <h1 className="tp-display text-2xl font-bold text-ink-900 mb-2">
          Page not found
        </h1>
        <Link to="/" className="text-sm font-semibold text-green-700 hover:text-green-800">
          Back to home
        </Link>
      </div>
    </div>
  );
}
