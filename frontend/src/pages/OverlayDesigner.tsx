import { Navigate, useLocation } from "react-router";

/** Legacy designer URL: the overlay studio lives on `/overlays` now. */
export function OverlayDesigner() {
  const { search } = useLocation();
  return <Navigate replace to={search ? `/overlays${search}` : "/overlays"} />;
}
