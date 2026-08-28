import type { Outing, Place, ScoredPlace, WizardInput } from "../types.js";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: options?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  places: {
    list: (params?: Record<string, string>) =>
      request<Place[]>(`/places${params ? `?${new URLSearchParams(params)}` : ""}`),
    get: (id: string) => request<Place>(`/places/${id}`),
    create: (data: Partial<Place>) => request<Place>("/places", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Place>) =>
      request<Place>(`/places/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id: string) => request<void>(`/places/${id}`, { method: "DELETE" }),
    importCsv: (file: File, defaultCategory?: string) => {
      const form = new FormData();
      form.append("file", file);
      if (defaultCategory) form.append("default_category", defaultCategory);
      return request<{ imported: number; skippedDuplicates: number; skippedInvalid: number; total: number }>(
        "/places/import",
        { method: "POST", body: form },
      );
    },
  },
  recommendations: {
    list: (params?: Record<string, string>) =>
      request<ScoredPlace[]>(`/recommendations${params ? `?${new URLSearchParams(params)}` : ""}`),
  },
  outings: {
    list: (params?: Record<string, string>) =>
      request<Outing[]>(`/outings${params ? `?${new URLSearchParams(params)}` : ""}`),
    get: (id: string) => request<Outing>(`/outings/${id}`),
    update: (id: string, data: Partial<Outing>) =>
      request<Outing>(`/outings/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    rate: (outingId: string, outingPlaceId: string, rating: "up" | "down", ratingNote?: string) =>
      request<Outing>(`/outings/${outingId}/places/${outingPlaceId}/rate`, {
        method: "POST",
        body: JSON.stringify({ rating, rating_note: ratingNote }),
      }),
  },
  wizard: {
    candidates: (input: WizardInput) =>
      request<{ input: WizardInput; days: unknown[] }>("/wizard/candidates", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  },
  itinerary: {
    generate: (input: WizardInput) =>
      request<{ summary: string; outings: Outing[] }>("/itinerary/generate", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    swap: (outingId: string, outingPlaceId: string) =>
      request<Outing>(`/itinerary/${outingId}/swap/${outingPlaceId}`, { method: "POST" }),
  },
};
