export function createEditorState({ saveRoad }) {
  let state = {
    mode: "idle",
    geometry: null,
    selectedRoad: null,
    saving: false,
    error: "",
  };

  return {
    getState() {
      return structuredClone(state);
    },
    setGeometry(geometry) {
      state = { ...state, geometry: structuredClone(geometry), mode: "drawing", error: "" };
    },
    selectRoad(road) {
      state = { ...state, selectedRoad: road ? structuredClone(road) : null, error: "" };
    },
    cancel() {
      state = { ...state, mode: "idle", geometry: null, saving: false, error: "" };
    },
    async save(form) {
      if (!state.geometry) {
        state = { ...state, error: "Avval ko‘chani chizing" };
        return { ok: false, error: state.error };
      }
      state = { ...state, saving: true, error: "" };
      try {
        const road = await saveRoad({ ...form, geometry: state.geometry });
        state = { ...state, mode: "idle", geometry: null, selectedRoad: road, saving: false, error: "" };
        return { ok: true, road };
      } catch (error) {
        state = { ...state, saving: false, error: error instanceof Error ? error.message : "Saqlashda xato" };
        return { ok: false, error: state.error };
      }
    },
  };
}
