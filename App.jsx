import React, { useEffect, useState, useRef } from "react";

const STORAGE_KEYS = {
  RECORDS: "ads_records_v1",
  USERS: "ads_users_v1",
  DEPOSITOS_SEMANA: "depositos_semana_v1",
  PAYMENTS_BY_WEEK: "deposit_payments_by_week_v1",
};

const DEFAULT_USERS = {
  "1001": { firstName: "João" },
  "1002": { firstName: "Maria" },
  "1003": { firstName: "Carlos" },
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch (err) {
    console.error("Erro ao salvar no localStorage", err);
  }
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function formatCurrency(n) {
  if (!n && n !== 0) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(n));
}

function isoDate(d) {
  const dt = new Date(d);
  return dt.toISOString().slice(0, 10);
}

function getWeekStartISO(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // domingo => segunda anterior
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

/**
 * paymentsByWeek structure:
 * {
 *   "2025-12-08": { "1001": "pending", "1002": "approved" },
 *   ...
 * }
 *
 * status: "pending" | "approved" | "denied"
 */

export default function App() {
  const [users, setUsers] = useState(() =>
    readJSON(STORAGE_KEYS.USERS, DEFAULT_USERS)
  );
  const [records, setRecords] = useState(() =>
    readJSON(STORAGE_KEYS.RECORDS, [])
  );

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const ADMIN_SECRET = "admin123";

  const [entryId, setEntryId] = useState("");
  const [entryName, setEntryName] = useState("");
  const [entryDate, setEntryDate] = useState(isoDate(new Date()));
  const [entryAmount, setEntryAmount] = useState("");
  const [entryCode, setEntryCode] = useState("");
  const [codeMode, setCodeMode] = useState("auto");
  const fileRef = useRef();

  const [depositosSemana, setDepositosSemana] = useState(() =>
    readJSON(STORAGE_KEYS.DEPOSITOS_SEMANA, [])
  );
  const [paymentsByWeek, setPaymentsByWeek] = useState(() =>
    readJSON(STORAGE_KEYS.PAYMENTS_BY_WEEK, {})
  );

  const [editando, setEditando] = useState(null);
  const [imageModalSrc, setImageModalSrc] = useState(null);

  const totalDeposited = records.reduce(
    (sum, r) => sum + Number(r.amount || 0),
    0
  );

  // persistência
  useEffect(() => writeJSON(STORAGE_KEYS.USERS, users), [users]);
  useEffect(() => writeJSON(STORAGE_KEYS.RECORDS, records), [records]);
  useEffect(
    () => writeJSON(STORAGE_KEYS.DEPOSITOS_SEMANA, depositosSemana),
    [depositosSemana]
  );
  useEffect(
    () => writeJSON(STORAGE_KEYS.PAYMENTS_BY_WEEK, paymentsByWeek),
    [paymentsByWeek]
  );

  // preencher nome se id já existe
  useEffect(() => {
    if (!entryId) return setEntryName("");
    const u = users[entryId];
    setEntryName(u ? u.firstName || "" : "");
  }, [entryId, users]);

  useEffect(() => {
    if (codeMode === "auto") {
      setEntryCode(generateNextCode(records, depositosSemana));
    }
  }, [codeMode, records, depositosSemana]);

  function generateNextCode(recordsArr = [], depsArr = []) {
    try {
      const codes = [];
      recordsArr.forEach((r) => r.code && codes.push(r.code));
      depsArr.forEach((d) => d.code && codes.push(d.code));
      let max = 0;
      codes.forEach((c) => {
        const m = c.match(/ADS-(\d+)/i);
        if (m) {
          const n = Number(m[1]);
          if (!Number.isNaN(n) && n > max) max = n;
        }
      });
      const next = max + 1;
      return `ADS-${String(next).padStart(4, "0")}`;
    } catch (err) {
      console.error("Erro ao gerar código", err);
      return `ADS-${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
    }
  }

  async function submitEntry(e) {
    e.preventDefault();
    try {
      if (!entryId || !entryName.trim() || !entryAmount || !entryCode.trim())
        return;

      // salva/atualiza usuário
      setUsers((prev) => {
        if (prev[entryId] && prev[entryId].firstName === entryName.trim())
          return prev;
        return { ...prev, [entryId]: { firstName: entryName.trim() } };
      });

      // lê foto (se houver)
      let photoData = null;
      if (fileRef.current?.files?.[0]) {
        try {
          photoData = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result);
            reader.onerror = rej;
            reader.readAsDataURL(fileRef.current.files[0]);
          });
        } catch (err) {
          console.warn("Falha ao ler imagem, continuando sem foto", err);
          photoData = null;
        }
      }

      const newUID = uid();
      const newRecord = {
        uid: newUID,
        id: entryId,
        name: users[entryId]?.firstName || entryName.trim(),
        date: isoDate(entryDate),
        amount: Number(entryAmount),
        photo: photoData,
        createdAt: new Date().toISOString(),
        code: entryCode.trim(),
      };

      setRecords((r) => [newRecord, ...r]);

      const dep = {
        uid: newUID,
        id: entryId,
        nome: newRecord.name,
        dia: isoDate(entryDate),
        valor: Number(entryAmount),
        foto: photoData,
        createdAt: newRecord.createdAt,
        code: entryCode.trim(),
      };

      setDepositosSemana((d) => [dep, ...d]);

      // inicializa status de pagamento como "pending" na semana do depósito
      const weekIso = getWeekStartISO(dep.dia);
      setPaymentsByWeek((p) => {
        const clone = { ...(p || {}) };
        clone[weekIso] = { ...(clone[weekIso] || {}) };
        // se já havia status para esse id, não sobrescreve. Caso contrário, define pending.
        if (clone[weekIso][dep.id] === undefined) {
          clone[weekIso][dep.id] = "pending";
        }
        return clone;
      });

      // reseta campos
      setEntryId("");
      setEntryAmount("");
      setEntryDate(isoDate(new Date()));
      setEntryName("");
      if (fileRef.current) fileRef.current.value = "";
      if (codeMode === "auto") {
        setEntryCode(generateNextCode([newRecord, ...records], [dep, ...depositosSemana]));
      } else {
        setEntryCode("");
      }
    } catch (err) {
      console.error("Erro no submitEntry", err);
      alert("Ocorreu um erro ao adicionar o depósito. Veja o console.");
    }
  }

  function adminLogin() {
    if (adminPassword === ADMIN_SECRET) setIsAdmin(true);
    setAdminPassword("");
  }

  function adminLogout() {
    setIsAdmin(false);
  }

  function deleteRecord(uid) {
    // remove da lista principal e da semana
    const toRemove = depositosSemana.find((d) => d.uid === uid);
    setRecords((r) => r.filter((x) => x.uid !== uid));
    setDepositosSemana((d) => d.filter((x) => x.uid !== uid));

    // limpa marcação de pagamento se existir
    if (toRemove) {
      const weekIso = getWeekStartISO(toRemove.dia);
      setPaymentsByWeek((p) => {
        const clone = { ...(p || {}) };
        if (clone[weekIso]) {
          const wk = { ...clone[weekIso] };
          if (wk[toRemove.id] !== undefined) {
            delete wk[toRemove.id];
            clone[weekIso] = wk;
          }
        }
        return clone;
      });
    }
  }

  function editRecord(uid, patch) {
    setRecords((r) =>
      r.map((x) => (x.uid === uid ? { ...x, ...patch } : x))
    );
    setDepositosSemana((d) =>
      d.map((x) =>
        x.uid === uid
          ? {
              ...x,
              ...(patch.name ? { nome: patch.name } : {}),
              ...(patch.date ? { dia: isoDate(patch.date) } : {}),
              ...(patch.amount !== undefined ? { valor: Number(patch.amount) } : {}),
              ...(patch.photo ? { foto: patch.photo } : {}),
              ...(patch.id ? { id: patch.id } : {}),
            }
          : x
      )
    );
  }

  function setPaymentStatusFor(weekIso, id, status) {
    // status deve ser "pending" | "approved" | "denied"
    setPaymentsByWeek((p) => {
      const clone = { ...(p || {}) };
      clone[weekIso] = { ...(clone[weekIso] || {}) };
      clone[weekIso][id] = status;
      return clone;
    });
  }

  function abrirEdicao(dep) {
    setEditando({ ...dep });
  }

  function salvarEdicao() {
    if (!editando || !editando.nome || !editando.dia || !editando.valor) return;

    const uidToEdit = editando.uid;
    const originalDep = depositosSemana.find((d) => d.uid === uidToEdit);
    const originalRecord = records.find((r) => r.uid === uidToEdit);

    const patch = {
      name: editando.nome,
      date: isoDate(editando.dia),
      amount: Number(editando.valor),
      photo: editando.foto,
      id: editando.id,
    };

    // atualiza records e depositosSemana
    editRecord(uidToEdit, {
      name: patch.name,
      date: patch.date,
      amount: patch.amount,
      photo: patch.photo,
      id: patch.id,
    });

    // ressincroniza paymentsByWeek caso id ou dia tenham mudado
    try {
      const prevId = originalDep?.id ?? originalRecord?.id;
      const prevDia = originalDep?.dia ?? originalRecord?.date;
      const newId = editando.id ?? prevId;
      const newDia = isoDate(editando.dia);

      if (prevId !== undefined) {
        const oldWeek = getWeekStartISO(prevDia);
        const newWeek = getWeekStartISO(newDia);

        setPaymentsByWeek((p) => {
          const clone = { ...(p || {}) };

          // pega status anterior (se existir)
          let prevStatus = undefined;
          if (clone[oldWeek] && clone[oldWeek][prevId] !== undefined) {
            prevStatus = clone[oldWeek][prevId];
            // remove
            const wkOld = { ...clone[oldWeek] };
            delete wkOld[prevId];
            clone[oldWeek] = wkOld;
          }

          // garante objeto na nova semana
          clone[newWeek] = { ...(clone[newWeek] || {}) };

          // se já existe status para newId na nova semana, preserva; senão usa prevStatus ou "pending"
          if (clone[newWeek][newId] === undefined) {
            clone[newWeek][newId] = prevStatus || "pending";
          }

          return clone;
        });
      }
    } catch (err) {
      console.error("Erro ao ressincronizar pagamentos na edição", err);
    }

    setEditando(null);
  }

  function openImageModal(src) {
    setImageModalSrc(src);
  }
  function closeImageModal() {
    setImageModalSrc(null);
  }

  // função utilitária para renderizar o ícone de status
  function renderStatusIcon(status) {
    if (status === "approved")
      return <span className="text-green-400 text-xl font-bold">✔</span>;
    if (status === "denied")
      return <span className="text-red-500 text-xl font-bold">✘</span>;
    return <span className="text-orange-400 text-xl font-bold">?</span>; // pending
  }

  return (
    <div className="min-h-screen bg-black text-gray-200 p-4 md:p-8 font-sans">
      {/* TOTAL FIXO */}
      <div className="fixed top-4 right-4 bg-neutral-900 border border-green-700/40 shadow-lg rounded-2xl p-4 z-50 flex items-center justify-between gap-4">
        <div>
          <div className="text-xs text-green-500">Depósito Total</div>
          <div className="text-xl font-bold text-green-400">
            {formatCurrency(totalDeposited)}
          </div>
        </div>

        {isAdmin && (
          <button
            onClick={() => {
              if (!confirm("Tem certeza que quer limpar todos os registros?")) return;
              setRecords([]);
              setDepositosSemana([]);
              setPaymentsByWeek({});
            }}
            className="px-3 py-1 border border-red-500 text-red-400 rounded-md hover:bg-red-600/20 transition"
          >
            Limpar
          </button>
        )}
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* FORMULÁRIO */}
        <div className="md:col-span-1 bg-neutral-900 rounded-2xl p-6 shadow-xl border border-green-700/30">
          <h2 className="text-2xl font-semibold mb-4 text-green-400">
            Registrar Depósito
          </h2>

          <form onSubmit={submitEntry}>
            <label className="block text-sm text-green-300">ID</label>
            <input
              value={entryId}
              onChange={(e) => setEntryId(e.target.value)}
              placeholder="Ex: 1001"
              className="w-full p-2 rounded-md bg-neutral-800 border border-green-700/40 text-gray-100 mt-1"
            />

            <label className="block text-sm text-green-300 mt-4">
              Nome completo do jogo
            </label>
            <input
              value={entryName}
              onChange={(e) => setEntryName(e.target.value)}
              placeholder="Digite nome completo"
              className="w-full p-2 rounded-md bg-neutral-800 border border-green-700/40 text-gray-100"
            />

            <label className="block text-sm text-green-300 mt-4">
              Valor que está pagando
            </label>
            <input
              value={entryAmount}
              onChange={(e) => setEntryAmount(e.target.value)}
              type="number"
              step="0.01"
              placeholder="0.00"
              className="w-full p-2 rounded-md bg-neutral-800 border border-green-700/40 text-gray-100 mt-1"
            />

            <label className="block text-sm text-green-300 mt-4">Data</label>
            <input
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              type="date"
              className="w-full p-2 rounded-md bg-neutral-800 border border-green-700/40 text-gray-100"
            />

            <label className="block text-sm text-green-300 mt-4">
              Foto (opcional)
            </label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="w-full text-gray-300 mt-1"
            />

            <label className="block text-sm text-green-300 mt-4">Código</label>
            <div className="flex gap-2 items-center">
              <input
                value={entryCode}
                onChange={(e) => {
                  setCodeMode("manual");
                  setEntryCode(e.target.value);
                }}
                placeholder="ADS-0001"
                className="flex-1 p-2 rounded-md bg-neutral-800 border border-green-700/40 text-gray-100 mt-1"
              />
              <button
                type="button"
                onClick={() => {
                  setCodeMode("auto");
                  setEntryCode(generateNextCode(records, depositosSemana));
                }}
                className="px-3 py-1 border rounded-md text-xs border-gray-500"
              >
                Auto
              </button>
            </div>

            <div className="mt-5 flex gap-3">
              <button
                type="submit"
                className="px-4 py-2 bg-green-700 text-white rounded-md hover:bg-green-600 transition"
              >
                Adicionar
              </button>

              <button
                type="button"
                onClick={() => {
                  setEntryId("");
                  setEntryName("");
                  setEntryAmount("");
                  setEntryDate(isoDate(new Date()));
                  setEntryCode(codeMode === "auto" ? generateNextCode(records, depositosSemana) : "");
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="px-4 py-2 border border-gray-500 rounded-md hover:bg-neutral-800 transition"
              >
                Limpar
              </button>
            </div>
          </form>
        </div>

        {/* REGISTROS RECENTES */}
        <div className="md:col-span-2 bg-neutral-900 rounded-2xl p-6 shadow-xl border border-green-700/30 flex flex-col">
          <h2 className="text-xl font-semibold text-green-400">Registros Recentes</h2>

          <div className="mt-4 space-y-2 overflow-auto max-h-56 md:max-h-72 pr-2">
            {records.map((r) => (
              <div
                key={r.uid}
                className="flex items-center gap-4 p-3 rounded-md bg-neutral-800 border border-neutral-700"
              >
                <div className="w-16 h-12 bg-neutral-700 flex items-center justify-center rounded-md overflow-hidden">
                  {r.photo ? (
                    <img
                      src={r.photo}
                      alt="comprovante"
                      onClick={() => openImageModal(r.photo)}
                      className="object-cover w-full h-full cursor-pointer hover:opacity-90 transition"
                    />
                  ) : (
                    <div className="text-xs text-gray-400">Sem foto</div>
                  )}
                </div>

                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-100">{r.name}</div>
                  <div className="text-xs text-gray-400">ID: {r.id} • {r.code}</div>
                </div>

                <div className="text-right">
                  <div className="font-semibold text-green-500">{formatCurrency(r.amount)}</div>
                  <div className="text-xs text-gray-500">{new Date(r.createdAt).toLocaleString("pt-BR")}</div>
                </div>
              </div>
            ))}
          </div>

          {/* TABELA DA SEMANA */}
          <div className="mt-6 border-t border-neutral-700 pt-4 flex-1 overflow-auto">
            <h3 className="text-lg font-medium text-green-400">Depósitos da Semana</h3>

            <div className="overflow-auto mt-3">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-left text-green-400">
                    <th className="p-2 border-b border-neutral-700">Código</th>
                    <th className="p-2 border-b border-neutral-700">Nome</th>
                    <th className="p-2 border-b border-neutral-700">Dia</th>
                    <th className="p-2 border-b border-neutral-700">Valor</th>
                    <th className="p-2 border-b border-neutral-700">Pago?</th>
                    {isAdmin && <th className="p-2 border-b border-neutral-700">Ações</th>}
                  </tr>
                </thead>

                <tbody>
                  {depositosSemana.map((item) => {
                    const weekIso = getWeekStartISO(item.dia);
                    // mostra apenas a semana atual
                    if (weekIso !== getWeekStartISO(new Date())) return null;

                    const status =
                    paymentsByWeek[weekIso] && paymentsByWeek[weekIso][item.id]
                        ? paymentsByWeek[weekIso][item.id]
                        : "pending";

                    return (
                      <tr key={item.uid} className="text-gray-300">
                        <td className="p-2 border-b border-neutral-800">{item.code || "—"}</td>

                        <td className="p-2 border-b border-neutral-800">{item.nome}</td>

                        <td className="p-2 border-b border-neutral-800">{new Date(item.dia).toLocaleDateString("pt-BR")}</td>

                        <td className="p-2 border-b border-neutral-800 text-green-500">{formatCurrency(item.valor)}</td>

                        <td className="p-2 border-b border-neutral-800 text-center">
                          {!isAdmin ? (
                            // visualização para usuários comuns
                            renderStatusIcon(status)
                          ) : (
                            // admin vê os botões (Opção B)
                            <div className="flex items-center gap-2 justify-center">
                              <button
                                title="Confirmar pagamento"
                                onClick={() => setPaymentStatusFor(weekIso, item.id, "approved")}
                                className={`px-2 py-1 rounded-md text-xs border ${status === "approved" ? "border-green-600 text-green-400" : "border-gray-500 text-gray-300"} hover:bg-neutral-800 transition`}
                              >
                                ✔
                              </button>

                              <button
                                title="Negar pagamento"
                                onClick={() => setPaymentStatusFor(weekIso, item.id, "denied")}
                                className={`px-2 py-1 rounded-md text-xs border ${status === "denied" ? "border-red-600 text-red-400" : "border-gray-500 text-gray-300"} hover:bg-neutral-800 transition`}
                              >
                                ✘
                              </button>

                              <button
                                title="Voltar para pendente"
                                onClick={() => setPaymentStatusFor(weekIso, item.id, "pending")}
                                className={`px-2 py-1 rounded-md text-xs border ${status === "pending" ? "border-orange-500 text-orange-300" : "border-gray-500 text-gray-300"} hover:bg-neutral-800 transition`}
                              >
                                ?
                              </button>
                            </div>
                          )}
                        </td>

                        {isAdmin && (
                          <td className="p-2 border-b border-neutral-800 flex gap-2">
                            <button
                              onClick={() => abrirEdicao(item)}
                              className="px-2 py-1 rounded-md border border-blue-500 text-blue-400 hover:bg-blue-600/20 transition"
                            >
                              Editar
                            </button>

                            <button
                              onClick={() => deleteRecord(item.uid)}
                              className="px-2 py-1 rounded-md border border-red-500 text-red-400 hover:bg-red-600/20 transition"
                            >
                              Excluir
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* BOTÃO LIMPAR TUDO - NOVA POSIÇÃO */}
            {isAdmin && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => {
                    if (!confirm("Tem certeza que quer limpar tudo?")) return;
                    setRecords([]);
                    setDepositosSemana([]);
                    setPaymentsByWeek({});
                  }}
                  className="px-4 py-2 border border-red-500 text-red-400 rounded-md hover:bg-red-600/20 transition"
                >
                  Limpar tudo
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL DE EDIÇÃO */}
      {editando && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-neutral-900 p-6 rounded-xl shadow-xl border border-green-700/40 w-[95%] max-w-lg">
            <h2 className="text-lg font-semibold text-green-400 mb-4">Editar Registro</h2>

            <label className="block text-sm text-green-300">ID</label>
            <input
              value={editando.id || ""}
              onChange={(e) => setEditando({ ...editando, id: e.target.value })}
              className="w-full p-2 bg-neutral-800 border border-green-700/40 rounded-md text-gray-100 mb-2"
            />

            <label className="block text-sm text-green-300">Nome</label>
            <input
              value={editando.nome || ""}
              onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
              className="w-full p-2 bg-neutral-800 border border-green-700/40 rounded-md text-gray-100 mb-2"
            />

            <label className="block text-sm text-green-300">Valor</label>
            <input
              type="number"
              value={editando.valor}
              onChange={(e) => setEditando({ ...editando, valor: e.target.value })}
              className="w-full p-2 bg-neutral-800 border border-green-700/40 rounded-md text-gray-100 mb-2"
            />

            <label className="block text-sm text-green-300">Data</label>
            <input
              type="date"
              value={isoDate(editando.dia)}
              onChange={(e) => setEditando({ ...editando, dia: e.target.value })}
              className="w-full p-2 bg-neutral-800 border border-green-700/40 rounded-md text-gray-100 mb-2"
            />

            <label className="block text-sm text-green-300">Foto (opcional)</label>

            {editando.foto && (
              <img
                src={editando.foto}
                className="w-full max-h-60 object-contain border border-neutral-700 rounded-md mb-3"
                alt="comprovante"
              />
            )}

            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = () => setEditando({ ...editando, foto: reader.result });
                  reader.readAsDataURL(file);
                }
              }}
              className="w-full text-gray-200 mb-4"
            />

            <div className="flex justify-end gap-3 mt-3">
              <button
                onClick={() => setEditando(null)}
                className="px-4 py-2 border border-gray-500 rounded-md hover:bg-neutral-800 transition"
              >
                Cancelar
              </button>

              <button
                onClick={salvarEdicao}
                className="px-4 py-2 bg-green-700 text-white rounded-md hover:bg-green-600 transition"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL IMAGEM */}
      {imageModalSrc && (
        <div onClick={closeImageModal} className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 border border-green-700/40 rounded-xl p-3 max-w-[95%] max-h-[95%] shadow-xl">
            <img src={imageModalSrc} className="max-w-full max-h-[80vh] object-contain" alt="comprovante grande" />
          </div>
        </div>
      )}

      {/* PAINEL ADMIN */}
      <div className="mt-10 bg-neutral-900 p-6 rounded-2xl shadow-xl border border-green-700/30 max-w-md mx-auto">
        {!isAdmin ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              adminLogin();
            }}
            className="flex gap-3"
          >
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Senha admin"
              className="flex-1 p-2 bg-neutral-800 border border-green-700/40 rounded-md text-gray-100"
            />

            <button className="px-4 py-2 bg-green-700 text-white rounded-md hover:bg-green-600 transition">
              Entrar
            </button>
          </form>
        ) : (
          <button onClick={adminLogout} className="px-4 py-2 border border-gray-500 rounded-md hover:bg-neutral-800 transition w-full">
            Sair
          </button>
        )}
      </div>
    </div>
  );
}
