import { BrowserRouter, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { TicketPage } from "./pages/TicketPage";
import { NotificationsProvider } from "./lib/notifications";

export function App() {
  return (
    <NotificationsProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/archive" element={<HomePage />} />
          <Route path="/epics" element={<HomePage />} />
          <Route path="/tickets/:name" element={<TicketPage />} />
          <Route path="/epics/:slug" element={<TicketPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </BrowserRouter>
    </NotificationsProvider>
  );
}
