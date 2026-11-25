import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Network as CapNetwork } from '@capacitor/network';
import { registerMutationListener } from '../db/repository';
import { initGoogleAuth } from './googleAuth';
import { refreshSyncSnapshot, runSync } from './syncEngine';

let initialized = false;

export function initSyncLifecycle(): () => void {
  if (initialized) return () => {};
  initialized = true;

  const handleOnline = () => {
    refreshSyncSnapshot().then(() => {
      runSync({ manual: false }).catch(() => {});
    });
  };

  const handleOffline = () => {
    refreshSyncSnapshot().catch(() => {});
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      refreshSyncSnapshot().then(() => {
        runSync({ manual: false }).catch(() => {});
      });
    }
  };

  const handleSwMessage = (event: MessageEvent) => {
    if (event.data && event.data.type === 'TRIGGER_SYNC') {
      runSync({ manual: false }).catch(() => {});
    }
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', handleSwMessage);
  }

  // Capacitor Android/iOS native lifecycle & network listeners
  if (Capacitor.isNativePlatform()) {
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        refreshSyncSnapshot().then(() => {
          runSync({ manual: false }).catch(() => {});
        });
      }
    }).catch(() => {});

    CapNetwork.addListener('networkStatusChange', ({ connected }) => {
      refreshSyncSnapshot().then(() => {
        if (connected) {
          runSync({ manual: false }).catch(() => {});
        }
      });
    }).catch(() => {});
  }

  // Auto-sync immediately after local mutations when online
  registerMutationListener(() => {
    refreshSyncSnapshot().then(() => {
      if (navigator.onLine) {
        runSync({ manual: false }).catch(() => {});
      }
    });
  });

  const unsubAuth = initGoogleAuth(
    () => {
      refreshSyncSnapshot().then(() => {
        runSync({ manual: false }).catch(() => {});
      });
    },
    () => {
      refreshSyncSnapshot().catch(() => {});
    }
  );

  // Trigger startup sync check
  refreshSyncSnapshot().then(() => {
    if (navigator.onLine) {
      runSync({ manual: false }).catch(() => {});
    }
  });

  return () => {
    initialized = false;
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    }
    unsubAuth();
  };
}
