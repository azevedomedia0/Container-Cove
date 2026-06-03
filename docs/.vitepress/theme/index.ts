import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import impactHeader from './components/impact-header.vue'
import marketing from './components/marketing.vue'
import './theme.css'

export default {
	extends: DefaultTheme,
	enhanceApp({ app }) {
		app.component('ImpactHeader', impactHeader)
		app.component('Marketing', marketing)
	},
} satisfies Theme
