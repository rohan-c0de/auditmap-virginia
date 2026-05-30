import dynamic from "next/dynamic";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] animate-pulse rounded-lg bg-gray-100" />
  ),
});

export default MapView;
