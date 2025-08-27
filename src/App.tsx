import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import EditWithWords from './pages/EditWithWords';
import { Toaster } from "@/components/ui/toaster";

// Placeholder for other pages
const Placeholder = ({ title }: { title: string }) => <div className="p-8 text-white">
  <h1 className="text-3xl font-bold">{title}</h1>
</div>;

function App() {
  return (
    <Router>
      <div className="flex h-screen bg-gray-900">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Placeholder title="Chat Agente" />} />
            <Route path="/clients" element={<Placeholder title="Clienti" />} />
            <Route path="/upload" element={<Placeholder title="Upload" />} />
            <Route path="/edit-with-words" element={<EditWithWords />} />
            <Route path="/gallery" element={<Placeholder title="Galleria" />} />
            <Route path="/armadio" element={<Placeholder title="Armadio" />} />
            <Route path="/pack-manager" element={<Placeholder title="Pack Manager" />} />
            <Route path="/settings" element={<Placeholder title="Settings" />} />
          </Routes>
        </main>
        <Toaster />
      </div>
    </Router>
  );
}

export default App;