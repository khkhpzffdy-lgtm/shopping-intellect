import { useConnectivityStore } from '../store/connectivity';
import { WifiOffIcon } from './icons';

export const OfflineBanner = () => {
  const isOnline = useConnectivityStore((state) => state.isOnline);

  if (isOnline) {
    return null;
  }

  return (
    <div className="offline-banner">
      <WifiOffIcon />
      Офлайн · отметките се запазват и ще се синхронизират
    </div>
  );
};
