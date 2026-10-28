<script setup>
import { requestItems } from '~/data/requests'
import { useUserStore } from '~/stores/user'

const route = useRoute()
const userStore = useUserStore()
const request = computed(() => requestItems.find((item) => String(item.id) === String(route.params.id)))

function toInputDate(value) {
  if (!value) return ''
  const [date, time] = value.split(', ')
  const [day, month, year] = date.split('.')
  return year + '-' + month + '-' + day + 'T' + time
}

const assigneeDraft = ref(request.value?.assignee || 'none')
const priorityDraft = ref(request.value?.priority)
const dueDraft = ref(toInputDate(request.value?.due))
const workComment = ref('')
const closingComment = ref('')

const assigneeOptions = [
  { label: 'Не назначен', value: 'none' },
  { label: 'Иванов', value: 'Иванов' },
  { label: 'Петров', value: 'Петров' },
]
const priorityOptions = [
  { label: 'Низкий', value: 'Низкий' },
  { label: 'Средний', value: 'Средний' },
  { label: 'Высокий', value: 'Высокий' },
  { label: 'Критичный', value: 'Критичный' },
]
const eventColumns = [
  { accessorKey: 'date', header: 'Когда' },
  { accessorKey: 'actor', header: 'Кто' },
  { accessorKey: 'action', header: 'Что изменилось' },
]
</script>

<template>
  <main class="mx-auto max-w-6xl space-y-6 px-4 py-10">
    <template v-if="request">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-semibold text-gray-900">Заявка №{{ request.id }}</h1>
        <UBadge color="primary" variant="soft">{{ request.status }}</UBadge>
      </div>

      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Данные заявки</h2>
        <dl class="grid gap-4 sm:grid-cols-2">
          <div><dt class="text-sm text-gray-600">Тип</dt><dd class="text-gray-900">{{ request.kind }}</dd></div>
          <div><dt class="text-sm text-gray-600">Источник</dt><dd class="text-gray-900">{{ request.source }}</dd></div>
          <div>
            <dt class="text-sm text-gray-600">Объект</dt>
            <dd class="text-gray-900">
              <NuxtLink v-if="request.equipmentId" :to="'/equipment/' + request.equipmentId" class="text-brand hover:text-brand-hover">
                {{ request.equipment }}
              </NuxtLink>
              <span v-else>{{ request.equipment }} (мониторинг)</span>
            </dd>
          </div>
          <div><dt class="text-sm text-gray-600">Приоритет</dt><dd class="text-gray-900">{{ request.priority }}</dd></div>
          <div><dt class="text-sm text-gray-600">Плановый срок</dt><dd :class="request.overdue ? 'text-red-500' : 'text-gray-900'">{{ request.due || 'Не задан' }}</dd></div>
          <div><dt class="text-sm text-gray-600">Исполнитель</dt><dd class="text-gray-900">{{ request.assignee || 'Не назначен' }}</dd></div>
          <div><dt class="text-sm text-gray-600">Автор</dt><dd class="text-gray-900">{{ request.author }}</dd></div>
          <div><dt class="text-sm text-gray-600">Создана</dt><dd class="text-gray-900">{{ request.createdAt }}</dd></div>
        </dl>
        <div class="mt-4">
          <p class="text-sm text-gray-600">Описание</p>
          <p class="text-gray-900">{{ request.description }}</p>
        </div>
      </UCard>

      <UCard v-if="request.monitoring" class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Контекст мониторинга</h2>
        <dl class="grid gap-4 sm:grid-cols-2">
          <div><dt class="text-sm text-gray-600">ВЭУ</dt><dd class="text-gray-900">{{ request.monitoring.turbine }}</dd></div>
          <div><dt class="text-sm text-gray-600">Адрес сигнала</dt><dd class="text-gray-900">{{ request.monitoring.address }}</dd></div>
          <div><dt class="text-sm text-gray-600">Статус</dt><dd class="text-gray-900">{{ request.monitoring.status }}</dd></div>
          <div><dt class="text-sm text-gray-600">Время приёма</dt><dd class="text-gray-900">{{ request.monitoring.receivedAt }}</dd></div>
          <div><dt class="text-sm text-gray-600">Свежий при создании</dt><dd class="text-gray-900">{{ request.monitoring.freshAtCreation }}</dd></div>
        </dl>
      </UCard>
      <UCard v-if="userStore.role === 'dispatcher' && request.source === 'Автоматическая' && !request.due" class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Первоначальный срок автозаявки</h2>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField label="Плановый срок">
            <UInput v-model="dueDraft" type="datetime-local" />
          </UFormField>
          <UButton type="button">Назначить срок</UButton>
        </div>
      </UCard>

      <UCard v-if="userStore.role === 'engineer' && (request.mine || request.available)" class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Работа по заявке</h2>
        <div class="space-y-4">
          <UFormField label="Диагностика и выполненные работы">
            <UTextarea v-model="workComment" placeholder="Опишите диагностику или выполненную работу" :rows="3" class="w-full" />
          </UFormField>
          <UFormField v-if="request.status === 'В работе'" label="Комментарий завершения">
            <UTextarea v-model="closingComment" placeholder="Опишите результат перед закрытием" :rows="3" class="w-full" />
          </UFormField>
          <div class="flex flex-wrap gap-2">
            <UButton v-if="request.status === 'Новая'" type="button">Взять в работу</UButton>
            <UButton v-if="request.status === 'В работе'" type="button" variant="outline">Ожидание ЗИП</UButton>
            <UButton v-if="request.status === 'Ожидание ЗИП'" type="button" variant="outline">Вернуть в работу</UButton>
            <UButton v-if="request.status === 'В работе'" type="button">Завершить с комментарием</UButton>
          </div>
        </div>
      </UCard>

      <UCard v-if="userStore.role === 'director' && request.status !== 'Выполнено'" class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Управление заявкой</h2>
        <div class="grid gap-4 sm:grid-cols-3">
          <UFormField label="Исполнитель">
            <USelect v-model="assigneeDraft" :items="assigneeOptions" value-key="value" class="w-full" />
          </UFormField>
          <UFormField label="Приоритет">
            <USelect v-model="priorityDraft" :items="priorityOptions" value-key="value" class="w-full" />
          </UFormField>
          <UFormField v-if="request.due" label="Плановый срок">
            <UInput v-model="dueDraft" type="datetime-local" class="w-full" />
          </UFormField>
        </div>
        <p v-if="!request.due" class="mt-4 text-sm text-gray-600">Первоначальный срок автозаявки задаёт дежурный.</p>
        <UButton type="button" class="mt-4">Сохранить изменения</UButton>
      </UCard>

      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Журнал действий</h2>
        <UTable :data="request.events" :columns="eventColumns" />
      </UCard>
    </template>

    <h1 v-else class="text-2xl font-semibold text-gray-900">Заявка не найдена</h1>
  </main>
</template>





