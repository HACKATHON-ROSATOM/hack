export const typeLabels = { INSPECTION: 'Осмотр', REPAIR: 'Ремонт' }
export const statusLabels = { NEW: 'Новая', IN_PROGRESS: 'В работе', WAITING_PARTS: 'Ожидание ЗИП', COMPLETED: 'Выполнено' }
export const priorityLabels = { LOW: 'Низкий', MEDIUM: 'Средний', HIGH: 'Высокий', CRITICAL: 'Критичный' }
export const actionLabels = { CREATED: 'Создана', STATUS_CHANGED: 'Изменён статус', ASSIGNED: 'Назначен исполнитель', DEADLINE_CHANGED: 'Изменён срок', PRIORITY_CHANGED: 'Изменён приоритет', TYPE_CHANGED: 'Изменён тип', COMMENT_ADDED: 'Добавлен комментарий' }

export function formatDate(value) {
  return value ? new Date(value).toLocaleString('ru-RU') : 'Не задан'
}

export function inputDate(value) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export async function loadEquipment(store) {
  const first = await store.api('/api/equipment?page=1&pageSize=100')
  const items = [...first.items]
  for (let page = 2; items.length < first.total; page++) {
    const next = await store.api(`/api/equipment?page=${page}&pageSize=100`)
    if (!next.items.length) break
    items.push(...next.items)
  }
  return items
}
