import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Home } from './pages/Home';
import { Register } from './pages/Register';
import { Catalog } from './pages/Catalog';
import { ProductDetail } from './pages/ProductDetail';
import { Cart } from './pages/Cart';
import { Checkout } from './pages/Checkout';
import { Orders } from './pages/Orders';
import { Profile } from './pages/Profile';
import { Favorites } from './pages/Favorites';
import { ContactUs } from './pages/ContactUs';
import { FAQ } from './pages/FAQ';
import { AboutUs } from './pages/AboutUs';
import { Notifications } from './pages/Notifications';
import { NotFound } from './pages/NotFound';
import { AdminLogin } from './pages/admin/AdminLogin';
import { AdminRoute } from './components/AdminRoute';
import { ToastContainer } from './components/Toast';

const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const AdminProducts = lazy(() => import('./pages/admin/AdminProducts').then(m => ({ default: m.AdminProducts })));
const AdminOrders = lazy(() => import('./pages/admin/AdminOrders').then(m => ({ default: m.AdminOrders })));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers').then(m => ({ default: m.AdminUsers })));
const AdminBanners = lazy(() => import('./pages/admin/AdminBanners').then(m => ({ default: m.AdminBanners })));
const AdminDelivery = lazy(() => import('./pages/admin/AdminDelivery').then(m => ({ default: m.AdminDelivery })));
const AdminCoupons = lazy(() => import('./pages/admin/AdminCoupons').then(m => ({ default: m.AdminCoupons })));
const AdminReturns = lazy(() => import('./pages/admin/AdminReturns').then(m => ({ default: m.AdminReturns })));
const AdminAuditLog = lazy(() => import('./pages/admin/AdminAuditLog').then(m => ({ default: m.AdminAuditLog })));
const AdminCategories = lazy(() => import('./pages/admin/AdminCategories').then(m => ({ default: m.AdminCategories })));
const AdminReviews = lazy(() => import('./pages/admin/AdminReviews').then(m => ({ default: m.AdminReviews })));
const AdminCollections = lazy(() => import('./pages/admin/AdminCollections').then(m => ({ default: m.AdminCollections })));
const AdminProductForm = lazy(() => import('./pages/admin/AdminProductForm').then(m => ({ default: m.AdminProductForm })));
const AdminEngagement = lazy(() => import('./pages/admin/AdminEngagement').then(m => ({ default: m.AdminEngagement })));
const AdminMessages = lazy(() => import('./pages/admin/AdminMessages').then(m => ({ default: m.AdminMessages })));

const AdminLoading = () => (
  <div className="min-h-screen bg-bg flex items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" />
      <span className="text-xs text-text-tertiary font-medium">Loading...</span>
    </div>
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
      // A Mini App runs on a phone, so a request lost to a tunnel or a handover
      // is the normal case rather than the exception — retry it before showing
      // the user a failure. Capped and backed off so a genuine outage does not
      // turn into a request storm against client-api's per-IP rate limit.
      retry: (failureCount, error) => {
        // Missing Telegram identity and 4xx are decisions, not glitches:
        // repeating the request produces the same answer.
        const message = error instanceof Error ? error.message : '';
        if (error instanceof Error && error.name === 'NoTelegramSessionError') return false;
        if (/HTTP 4\d\d/.test(message)) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
  },
});

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Suspense fallback={<AdminLoading />}>
          <Routes>
          {/* Public shop routes */}
          <Route path="/" element={<Home />} />
          <Route path="/register" element={<Register />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/product/:slug" element={<ProductDetail />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/contact" element={<ContactUs />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/about" element={<AboutUs />} />

          {/* Admin login — public */}
          <Route path="/nanyy" element={<AdminLogin />} />

          {/* Protected admin routes */}
          <Route
            path="/nanyy/dashboard"
            element={
              <AdminRoute>
                <AdminDashboard />
              </AdminRoute>
            }
          />
          <Route
            path="/nanyy/products"
            element={
              <AdminRoute requires="products">
                <AdminProducts />
              </AdminRoute>
            }
          />
          <Route
            path="/nanyy/products/new"
            element={
              <AdminRoute requires="products">
                <AdminProductForm />
              </AdminRoute>
            }
          />
          <Route
            path="/nanyy/products/:id/edit"
            element={
              <AdminRoute requires="products">
                <AdminProductForm />
              </AdminRoute>
            }
          />
          <Route
            path="/nanyy/orders"
            element={
              <AdminRoute requires="orders">
                <AdminOrders />
              </AdminRoute>
            }
          />
          <Route
            path="/nanyy/users"
            element={
              <AdminRoute requires="admins">
                <AdminUsers />
              </AdminRoute>
            }
          />
          <Route
            path="/nanyy/banners"
            element={
              <AdminRoute requires="banners">
                <AdminBanners />
              </AdminRoute>
            }
          />
          <Route
            path="/nanyy/categories"
            element={
              <AdminRoute requires="products">
                <AdminCategories />
              </AdminRoute>
            }
          />
          <Route
            path="/nanyy/reviews"
            element={
              <AdminRoute requires="reviews">
                <AdminReviews />
              </AdminRoute>
            }
          />
          <Route
            path="/nanyy/collections"
            element={
              <AdminRoute requires="products">
                <AdminCollections />
              </AdminRoute>
            }
          />
          <Route
            path="/nanyy/delivery"
            element={
              <AdminRoute requires="delivery">
                <AdminDelivery />
              </AdminRoute>
            }
          />
          <Route
            path="/nanyy/coupons"
            element={
              <AdminRoute requires="coupons">
                <AdminCoupons />
              </AdminRoute>
            }
          />
          <Route
            path="/nanyy/returns"
            element={
              <AdminRoute requires="returns">
                <AdminReturns />
              </AdminRoute>
            }
          />
          <Route
            path="/nanyy/audit"
            element={
              <AdminRoute requires="audit" mode="read">
                <AdminAuditLog />
              </AdminRoute>
            }
          />
          <Route
            path="/nanyy/engagement"
            element={
              <AdminRoute requires="analytics" mode="read">
                <AdminEngagement />
              </AdminRoute>
            }
          />
          <Route
            path="/nanyy/messages"
            element={
              <AdminRoute requires="messages">
                <AdminMessages />
              </AdminRoute>
            }
          />

          <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        <ToastContainer />
      </BrowserRouter>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
