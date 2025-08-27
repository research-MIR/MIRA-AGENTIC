"use client";

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bot, Users, Upload, Wand2, GalleryHorizontal, Box, Package, LogOut, Settings } from 'lucide-react';

const navItems = [
  { href: '/', label: 'Chat Agente', icon: Bot },
  { href: '/clients', label: 'Clienti', icon: Users },
  { href: '/upload', label: 'Upload', icon: Upload },
  { href: '/edit-with-words', label: 'Modifica con Parole', icon: Wand2 },
  { href: '/gallery', label: 'Galleria', icon: GalleryHorizontal },
  { href: '/armadio', label: 'Armadio', icon: Box },
  { href: '/pack-manager', label: 'Pack Manager', icon: Package },
];

const Sidebar = () => {
  const location = useLocation();

  return (
    <div className="flex flex-col h-full bg-gray-800 text-white w-64 p-4">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">MIRA</h1>
      </div>
      <nav className="flex-grow">
        <ul>
          {navItems.map((item) => (
            <li key={item.href} className="mb-2">
              <Link
                to={item.href}
                className={`flex items-center p-2 rounded-md transition-colors ${
                  location.pathname === item.href
                    ? 'bg-blue-600'
                    : 'hover:bg-gray-700'
                }`}
              >
                <item.icon className="mr-3 h-5 w-5" />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div>
        <ul>
            <li className="mb-2">
                <Link to="/settings" className="flex items-center p-2 rounded-md hover:bg-gray-700">
                    <Settings className="mr-3 h-5 w-5" />
                    Settings
                </Link>
            </li>
            <li className="mb-2">
                <button className="flex items-center p-2 rounded-md hover:bg-gray-700 w-full text-left">
                    <LogOut className="mr-3 h-5 w-5" />
                    Logout
                </button>
            </li>
        </ul>
      </div>
    </div>
  );
};

export default Sidebar;