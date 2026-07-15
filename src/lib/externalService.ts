import { confirmExternalNavigation, openExternalUrl } from "./desktop";

export interface ExternalServiceLaunchTarget {
  name: string;
  url: string;
  confirmationMessage: string;
}

export interface ExternalServiceLauncher {
  confirm: (serviceName: string, message: string) => Promise<boolean>;
  open: (url: string) => Promise<void>;
}

const defaultLauncher: ExternalServiceLauncher = {
  confirm: confirmExternalNavigation,
  open: openExternalUrl,
};

export async function launchExternalService(
  service: ExternalServiceLaunchTarget,
  launcher: ExternalServiceLauncher = defaultLauncher,
): Promise<boolean> {
  const confirmed = await launcher.confirm(
    service.name,
    service.confirmationMessage,
  );
  if (!confirmed) return false;

  await launcher.open(service.url);
  return true;
}
