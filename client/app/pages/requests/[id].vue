<script setup>
import { useUserStore } from '~/stores/user'
import { typeLabels, statusLabels, priorityLabels, actionLabels, formatDate, inputDate, errorMessage } from '~/components/requests/requestUtils'

const route = useRoute()
const userStore = useUserStore()
const request = ref(null)
const equipment = ref(null)
const engineers = ref([])
const users = ref([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const actionError = ref('')
const assigneeDraft = ref('')
const priorityDraft = ref('')
const dueDraft = ref('')
const managementComment = ref('')
const workComment = ref('')
const closingComment = ref('')
const priorityOptions = Object.entries(priorityLabels).map(([value, label]) => ({ value, label }))
const assigneeOptions = computed(() => engineers.value.map((item) => ({ label: item.name, value: item.id })))
const isAssignedEngineer = computed(() => userStore.role === 'engineer' && userStore.user?.id === request.value?.assigneeId)
const canAssign = computed(() => ['dispatcher', 'director'].includes(userStore.role) && request.value?.status !== 'COMPLETED')

function setRequest(value) {
  request.value = value
  assigneeDraft.value = value.assigneeId || ''
  priorityDraft.value = value.priority
  dueDraft.value = inputDate(value.currentDeadline)
}
function person(id) {
  if (!id) return 'Не указан'
  return users.value.find((item) => item.id === id)?.name || id
}
function auditValue(log, value) {
  if (!value) return '—'
  if (log.fieldName === 'assigneeId') return person(value)
  if (log.fieldName === 'status') return statusLabels[value] || value
  if (log.fieldName === 'type') return typeLabels[value] || value
  if (log.fieldName === 'priority') return priorityLabels[value] || value
  if (log.fieldName === 'currentDeadline') return formatDate(value)
  return value
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    await userStore.restore()
    const [data, people, allUsers] = await Promise.all([userStore.api(`/api/requests/${route.params.id}`), userStore.api('/api/engineers'), userStore.api('/api/users')])
    const object = await userStore.api(`/api/equipment/${data.equipmentId}`)
    engineers.value = people.items
    users.value = allUsers.items
    equipment.value = object
    setRequest(data)
  } catch (err) { error.value = errorMessage(err) } finally { loading.value = false }
}
onMounted(load)
watch(() => route.params.id, () => { if (import.meta.client) load() })

async function update(path, method, body) {
  actionError.value = ''
  busy.value = true
  try {
    const data = await userStore.api(`/api/requests/${request.value.id}/${path}`, { method, body })
    setRequest(data)
    return true
  } catch (err) { actionError.value = errorMessage(err); return false } finally { busy.value = false }
}
async function assign() {
  if (!assigneeDraft.value) { actionError.value = 'Выберите инженера.'; return }
  await update('assignment', 'PATCH', { assigneeId: assigneeDraft.value, ...(managementComment.value.trim() ? { comment: managementComment.value.trim() } : {}) })
}
async function schedule() {
  const body = {}
  if (priorityDraft.value !== request.value.priority) body.priority = priorityDraft.value
  if (dueDraft.value !== inputDate(request.value.currentDeadline)) {
    if (!dueDraft.value || Number.isNaN(new Date(dueDraft.value).getTime())) { actionError.value = 'Укажите корректный срок.'; return }
    body.currentDeadline = new Date(dueDraft.value).toISOString()
  }
  if (!body.priority && !body.currentDeadline) { actionError.value = 'Измените срок или приоритет.'; return }
  if (managementComment.value.trim()) body.comment = managementComment.value.trim()
  await update('schedule', 'PATCH', body)
}
async function transition(toStatus) {
  const comment = (toStatus === 'COMPLETED' ? closingComment.value : workComment.value).trim()
  if (toStatus === 'COMPLETED' && !comment) { actionError.value = 'Для завершения укажите результат работы.'; return }
  if (await update('transitions', 'POST', { toStatus, ...(comment ? { comment } : {}) })) {
    if (toStatus === 'COMPLETED') closingComment.value = ''
    else workComment.value = ''
  }
}
async function convert() {
  const comment = workComment.value.trim()
  if (!comment) { actionError.value = 'Укажите причину перевода в ремонт.'; return }
  if (await update('convert-to-repair', 'POST', { comment })) workComment.value = ''
}
</script>

<template>
  <main class="mx-auto max-w-6xl space-y-6 px-4 py-10">
    <p v-if="loading" role="status">Загрузка заявки…</p>
    <div v-else-if="error" role="alert" class="space-y-3 text-red-700"><p>{{ error }}</p><UButton variant="outline" @click="load">Повторить</UButton><UButton to="/requests" variant="link">К списку заявок</UButton></div>
    <template v-else-if="request">
      <div class="flex flex-wrap items-center gap-3"><h1 class="text-2xl font-semibold text-gray-900">Заявка №{{ request.ticketNumber }}</h1><UBadge color="primary" variant="soft">{{ statusLabels[request.status] || request.status }}</UBadge></div>
      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Данные заявки</h2>
        <dl class="grid gap-4 sm:grid-cols-2">
          <div><dt class="text-sm text-gray-600">Тип</dt><dd>{{ typeLabels[request.type] || request.type }}</dd></div>
          <div><dt class="text-sm text-gray-600">Источник</dt><dd>{{ request.source === 'AUTO' ? 'Автоматическая' : 'Ручная' }}</dd></div>
          <div><dt class="text-sm text-gray-600">Объект</dt><dd><NuxtLink :to="'/equipment/' + request.equipmentId" class="text-brand hover:text-brand-hover">{{ equipment.name }}{{ equipment.externalId ? ` (${equipment.externalId})` : '' }}</NuxtLink></dd></div>
          <div><dt class="text-sm text-gray-600">Приоритет</dt><dd>{{ priorityLabels[request.priority] || request.priority }}</dd></div>
          <div><dt class="text-sm text-gray-600">Плановый срок</dt><dd :class="request.isOverdue ? 'text-red-500' : 'text-gray-900'">{{ formatDate(request.currentDeadline) }}<span v-if="request.isOverdue"> (просрочена)</span></dd></div>
          <div><dt class="text-sm text-gray-600">Исполнитель</dt><dd>{{ request.assigneeId ? person(request.assigneeId) : 'Не назначен' }}</dd></div>
          <div><dt class="text-sm text-gray-600">Автор</dt><dd>{{ person(request.authorId) }}</dd></div>
          <div><dt class="text-sm text-gray-600">Создана</dt><dd>{{ formatDate(request.createdAt) }}</dd></div>
          <div v-if="request.completedAt"><dt class="text-sm text-gray-600">Завершена</dt><dd>{{ formatDate(request.completedAt) }}</dd></div>
        </dl>
        <div class="mt-4"><p class="text-sm text-gray-600">Описание</p><p class="whitespace-pre-wrap">{{ request.description }}</p></div>
        <div v-if="request.completionComment" class="mt-4"><p class="text-sm text-gray-600">Результат работы</p><p class="whitespace-pre-wrap">{{ request.completionComment }}</p></div>
      </UCard>
      <p v-if="actionError" role="alert" class="text-red-700">{{ actionError }}</p>
      <UCard v-if="isAssignedEngineer && request.status !== 'COMPLETED'" class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Работа по заявке</h2>
        <div class="space-y-4">
          <UFormField label="Комментарий к действию"><UTextarea v-model="workComment" maxlength="2000" placeholder="Диагностика, выполненные работы или причина перевода в ремонт" :rows="3" class="w-full" /><p class="mt-1 text-sm text-gray-600">Комментарий сохраняется при смене статуса или переводе в ремонт.</p></UFormField>
          <UFormField v-if="request.status === 'IN_PROGRESS'" label="Комментарий завершения" required><UTextarea v-model="closingComment" maxlength="2000" placeholder="Опишите результат перед закрытием" :rows="3" class="w-full" /></UFormField>
          <div class="flex flex-wrap gap-2">
            <UButton v-if="request.status === 'NEW'" :disabled="busy" @click="transition('IN_PROGRESS')">Взять в работу</UButton>
            <UButton v-if="request.status === 'IN_PROGRESS'" variant="outline" :disabled="busy" @click="transition('WAITING_PARTS')">Ожидание ЗИП</UButton>
            <UButton v-if="request.status === 'WAITING_PARTS'" variant="outline" :disabled="busy" @click="transition('IN_PROGRESS')">Вернуть в работу</UButton>
            <UButton v-if="request.type === 'INSPECTION'" variant="outline" :disabled="busy" @click="convert">Перевести в ремонт</UButton>
            <UButton v-if="request.status === 'IN_PROGRESS'" :disabled="busy" @click="transition('COMPLETED')">Завершить с комментарием</UButton>
          </div>
        </div>
      </UCard>
      <UCard v-if="canAssign" class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Управление заявкой</h2>
        <div class="space-y-4">
          <UFormField label="Исполнитель"><USelect v-model="assigneeDraft" :items="assigneeOptions" value-key="value" placeholder="Выберите инженера" class="w-full" /><p v-if="!engineers.length" class="mt-1 text-sm text-gray-600">Нет доступных инженеров.</p></UFormField>
          <div v-if="userStore.role === 'director'" class="grid gap-4 sm:grid-cols-2"><UFormField label="Приоритет"><USelect v-model="priorityDraft" :items="priorityOptions" value-key="value" class="w-full" /></UFormField><UFormField label="Плановый срок"><UInput v-model="dueDraft" type="datetime-local" class="w-full" /></UFormField></div>
          <UFormField label="Комментарий к изменению"><UTextarea v-model="managementComment" maxlength="1000" :rows="2" class="w-full" /></UFormField>
          <div class="flex flex-wrap gap-2"><UButton :disabled="busy || !engineers.length" @click="assign">Назначить исполнителя</UButton><UButton v-if="userStore.role === 'director'" variant="outline" :disabled="busy" @click="schedule">Сохранить срок и приоритет</UButton></div>
        </div>
      </UCard>
      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Журнал действий</h2>
        <p v-if="!request.auditLogs.length" class="text-gray-600">Записей пока нет.</p>
        <ol v-else class="divide-y divide-gray-200"><li v-for="log in request.auditLogs" :key="log.id" class="space-y-1 py-3"><p class="font-medium">{{ actionLabels[log.action] || log.action }}</p><p class="text-sm text-gray-600">{{ formatDate(log.createdAt) }} · {{ person(log.authorId) }}</p><p v-if="log.fieldName" class="text-sm">{{ auditValue(log, log.oldValue) }} → {{ auditValue(log, log.newValue) }}</p><p v-if="log.comment" class="whitespace-pre-wrap text-sm">{{ log.comment }}</p></li></ol>
      </UCard>
    </template>
  </main>
</template>
