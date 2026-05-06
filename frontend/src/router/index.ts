import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      redirect: '/'
    },
    {
      path: '/register',
      redirect: '/'
    },
    {
      path: '/',
      name: 'Home',
      component: () => import('@/views/HomeView.vue')
    }
  ]
})

export default router
