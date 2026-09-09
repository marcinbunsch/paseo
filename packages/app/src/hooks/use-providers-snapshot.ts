import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AgentProvider, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useReplicaQuery } from "@/data/query";
import { queryClient as singletonQueryClient } from "@/data/query-client";
import {
  normalizeProvidersSnapshotCwd,
  providersSnapshotQueryKey,
  providersSnapshotQueryRoot,
  fetchProvidersSnapshot,
  refreshAndApplyProvidersSnapshot,
} from "@/data/providers-snapshot";

export {
  providersSnapshotQueryKey,
  providersSnapshotQueryRoot,
  fetchProvidersSnapshot,
  refreshAndApplyProvidersSnapshot,
};

export type ProvidersSnapshotClient = Pick<
  DaemonClient,
  "getProvidersSnapshot" | "refreshProvidersSnapshot"
>;

export type SelectorOpenRefetchDecision = "refetch-stale" | "refetch-always";

export function selectorOpenRefetchDecision(input: {
  entries: ProviderSnapshotEntry[] | undefined;
  selectedProvider: AgentProvider | null | undefined;
}): SelectorOpenRefetchDecision {
  if (!input.selectedProvider) {
    return "refetch-stale";
  }
  const selectedEntry = input.entries?.find((entry) => entry.provider === input.selectedProvider);
  if (!selectedEntry || selectedEntry.status === "loading") {
    return "refetch-always";
  }
  return "refetch-stale";
}

interface UseProvidersSnapshotResult {
  entries: ProviderSnapshotEntry[] | undefined;
  projectDefault:
    | {
        provider: AgentProvider;
        model: string;
        modeId?: string;
        thinkingOptionId?: string;
      }
    | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isRefreshing: boolean;
  error: string | null;
  supportsSnapshot: boolean;
  refresh: (providers?: AgentProvider[]) => Promise<void>;
  refetchIfStale: (selectedProvider?: AgentProvider | null) => void;
}

interface UseProvidersSnapshotOptions {
  enabled?: boolean;
  cwd?: string | null;
  projectId?: string | null;
}

export function useProvidersSnapshot(
  serverId: string | null,
  options: UseProvidersSnapshotOptions = {},
): UseProvidersSnapshotResult {
  const { t } = useTranslation();
  const retainedPanelActive = useRetainedPanelActive();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const enabled = (options.enabled ?? true) && retainedPanelActive;
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const cwd = normalizeProvidersSnapshotCwd(options.cwd);
  const supportsSnapshot = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.providersSnapshot === true,
  );

  const projectId = options.projectId?.trim() || null;
  const queryKey = useMemo(
    () => providersSnapshotQueryKey(serverId, cwd, projectId),
    [cwd, projectId, serverId],
  );

  const snapshotQuery = useReplicaQuery({
    queryKey,
    enabled: Boolean(enabled && supportsSnapshot && serverId && client && isConnected),
    pushEvent: "providers_snapshot_update",
    queryFn: async ({ signal }) => {
      if (!client || !serverId) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return fetchProvidersSnapshot({ client, serverId, cwd, projectId, queryClient, signal });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async (providers?: AgentProvider[]) => {
      if (!client || !serverId) {
        return;
      }
      await refreshAndApplyProvidersSnapshot({
        client,
        queryClient,
        serverId,
        cwd,
        projectId,
        providers,
      });
    },
  });
  const { mutateAsync: refreshSnapshot, isPending: isRefreshing } = refreshMutation;

  const refresh = useCallback(
    async (providers?: AgentProvider[]) => {
      await refreshSnapshot(providers);
    },
    [refreshSnapshot],
  );

  const refetchIfStale = useCallback(
    (selectedProvider?: AgentProvider | null) => {
      const decision = selectorOpenRefetchDecision({
        entries: snapshotQuery.data?.entries,
        selectedProvider,
      });
      if (decision === "refetch-always") {
        void queryClient.refetchQueries({ queryKey, type: "active" });
        return;
      }
      void queryClient.refetchQueries({ queryKey, type: "active", stale: true });
    },
    [queryClient, queryKey, snapshotQuery.data?.entries],
  );

  return {
    entries: snapshotQuery.data?.entries ?? undefined,
    projectDefault: snapshotQuery.data?.projectDefault,
    isLoading: snapshotQuery.isLoading,
    isFetching: snapshotQuery.isFetching,
    isRefreshing,
    error: snapshotQuery.error instanceof Error ? snapshotQuery.error.message : null,
    supportsSnapshot,
    refresh,
    refetchIfStale,
  };
}

export function prefetchProvidersSnapshot(
  serverId: string,
  client: DaemonClient,
  options: { cwd?: string | null; projectId?: string | null } = {},
): void {
  const cwd = normalizeProvidersSnapshotCwd(options.cwd);
  const projectId = options.projectId?.trim() || null;
  const queryKey = providersSnapshotQueryKey(serverId, cwd, projectId);
  void singletonQueryClient.prefetchQuery({
    queryKey,
    staleTime: Infinity,
    queryFn: ({ signal }) =>
      fetchProvidersSnapshot({
        client,
        serverId,
        cwd,
        projectId,
        queryClient: singletonQueryClient,
        signal,
      }),
  });
}
