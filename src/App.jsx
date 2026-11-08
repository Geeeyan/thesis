import React from "react";
import { Routes, Route } from "react-router-dom";

import Landing from "./landing";
import Login from "./pages/login";
import Signup from "./pages/signup";
import Contact from "./pages/contact";
import Services from "./pages/services";
import About from "./pages/about";
import Reservation from "./pages/reservation";
import Payment from "./pages/payment";
import ServiceDetail from "./pages/servicedetail";

import ProtectedRoute from "./staffs/staffprotectedroute";
import StaffDashboard from "./staffs/staffdashboard";

import AdminProtectedRoute from "./admin/adminprotectedroute";
import AdminDashboard from "./admin/admindashboard";
import UserProtectedRoute from "./pages/userprotectedroute";
import UserDashboard from "./pages/userdashboard";
import ProfileSettings from "./pages/profilesettings";
import ProfileProtectedRoute from "./pages/profileprotectedroute";
import ProfileEmailVerification from "./pages/profileemailverification";

function App() {
  return (
    <Routes>
      {/* User */}
      <Route path="/"            element={<Landing />} />
      <Route path="/login"       element={<Login />} />
      <Route path="/signup"      element={<Signup />} />
      <Route path="/contact"     element={<Contact />} />
      <Route path="/services"    element={<Services />} />
      <Route path="/about"       element={<About />} />
      <Route path="/reservation" element={<Reservation />} />
      <Route path="/payment"     element={<Payment />} />
      <Route path="/services/:slug" element={<ServiceDetail />} />
      <Route path="/user/dashboard" element={
        <UserProtectedRoute>
          <UserDashboard />
        </UserProtectedRoute>
      } />
      <Route path="/user/profile-settings" element={
        <ProfileProtectedRoute>
          <ProfileSettings />
        </ProfileProtectedRoute>
      } />
      <Route path="/verify-profile-email" element={<ProfileEmailVerification />} />

      {/* Staff */}
      <Route path="/staff/dashboard" element={
        <ProtectedRoute>
          <StaffDashboard />
        </ProtectedRoute>
      } />

      {/* Admin */}
      <Route path="/admin/dashboard" element={
        <AdminProtectedRoute>
          <AdminDashboard />
        </AdminProtectedRoute>
      } />
    </Routes>
  );
}

export default App;
