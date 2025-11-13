import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, 
} from 'firebase/auth';
import { 
  getFirestore, doc, collection, query, where, onSnapshot, setDoc, 
  Timestamp, getDoc, addDoc
} from 'firebase/firestore';
// Assuming lucide-react is available for icons
import { LayoutDashboard, BookOpen, Clock, User, PlusCircle, Calendar, Trash2, Loader2, ListPlus } from 'lucide-react';

// --- Global Variables and Configuration Setup ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// The main App component
const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState('assignments');
  const [loading, setLoading] = useState(true);

  // Data states
  const [assignments, setAssignments] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [profile, setProfile] = useState({ name: 'RBC Faculty', email: 'faculty@rbc.edu', course: 'CS101' });

  // Form states for adding content
  const [newAssignment, setNewAssignment] = useState({
    title: '', description: '', dueDate: '', course: 'CS101'
  });
  const [newSchedule, setNewSchedule] = useState({
    course: 'CS101', location: '', time: '', day: 'Monday', instructor: 'Dr. Smith'
  });

  // Available courses for the faculty member
  const availableCourses = useMemo(() => ['CS101', 'BIO205', 'ENG300'], []); 

  // Memoized Firebase Initialization (Runs once)
  useEffect(() => {
    try {
      if (Object.keys(firebaseConfig).length === 0) {
        console.error("Firebase config is missing. App cannot initialize.");
        setLoading(false);
        return;
      }
      
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const userAuth = getAuth(app);
      
      setDb(firestore);
      setAuth(userAuth);
      
      // 1. Initial Authentication Logic
      const handleAuth = async () => {
        try {
          if (initialAuthToken) {
            await signInWithCustomToken(userAuth, initialAuthToken);
          } else {
            // For a production faculty portal, we would enforce proper sign-in.
            // Using anonymous sign-in for canvas environment demo.
            await signInAnonymously(userAuth); 
          }
        } catch (error) {
          console.error("Firebase authentication failed:", error);
        }
      };

      // 2. Auth State Listener
      const unsubscribe = onAuthStateChanged(userAuth, (user) => {
        if (user) {
          setUserId(user.uid); 
        } else {
          setUserId(crypto.randomUUID()); 
        }
        setIsAuthReady(true);
        setLoading(false);
      });
      
      handleAuth();
      
      return () => unsubscribe();
      
    } catch (e) {
      console.error("Failed to initialize Firebase:", e);
      setLoading(false);
    }
  }, []);

  // --- Firestore Data Fetching & Profile Setup ---
  
  // Set up Faculty Profile (Private to User)
  useEffect(() => {
    if (!db || !userId || !isAuthReady) return;

    const profileRef = doc(db, `artifacts/${appId}/users/${userId}/faculty_profile/user_data`);

    // Add initial profile data if it doesn't exist (simulating a setup)
    const initializeProfile = async () => {
      const docSnap = await getDoc(profileRef);
      if (!docSnap.exists()) {
        const defaultProfile = {
            name: 'Dr. Jane Smith',
            facultyId: userId.substring(0, 8),
            email: 'jane.smith@rbc.edu',
            course: 'CS101', // Default course assignment
            lastLogin: Timestamp.now(),
        };
        await setDoc(profileRef, defaultProfile);
        setProfile(defaultProfile);
      } else {
        setProfile(docSnap.data());
      }
    };
    
    initializeProfile();
    
    // Set up real-time listener for the profile
    const unsubscribe = onSnapshot(profileRef, (docSnap) => {
      if (docSnap.exists()) {
        setProfile(docSnap.data());
      }
    }, (error) => {
      console.error("Error listening to faculty profile:", error);
    });

    return () => unsubscribe();
  }, [db, userId, isAuthReady]);

  // Fetch Assignments and Schedule (Public/Shared - Filtered by Faculty's Course)
  useEffect(() => {
    if (!db || !isAuthReady || !profile.course) return;

    // 1. Assignments
    const assignmentsCollectionRef = collection(db, `artifacts/${appId}/public/data/assignments`);
    const qA = query(assignmentsCollectionRef, where('course', '==', profile.course));

    const unsubscribeA = onSnapshot(qA, (snapshot) => {
      const assignmentsList = snapshot.docs.map(d => ({ 
        id: d.id, 
        ...d.data(), 
        dueDate: d.data().dueDate ? d.data().dueDate.toDate() : null 
      }));
      setAssignments(assignmentsList.sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0)));
    }, (error) => {
      console.error("Error listening to assignments:", error);
    });

    // 2. Schedule
    const scheduleCollectionRef = collection(db, `artifacts/${appId}/public/data/schedule`);
    const qS = query(scheduleCollectionRef, where('course', '==', profile.course));

    const unsubscribeS = onSnapshot(qS, (snapshot) => {
      const scheduleList = snapshot.docs.map(d => ({ 
        id: d.id, 
        ...d.data(),
        time: d.data().time || 'N/A'
      }));
      setSchedule(scheduleList);
    }, (error) => {
      console.error("Error listening to schedule:", error);
    });

    return () => {
      unsubscribeA();
      unsubscribeS();
    };
  }, [db, isAuthReady, profile.course]);

  // --- Form Handlers for Content Creation ---

  const handleAssignmentChange = (e) => {
    setNewAssignment(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };
  
  const handleScheduleChange = (e) => {
    setNewSchedule(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handlePostAssignment = useCallback(async (e) => {
    e.preventDefault();
    if (!db || !newAssignment.title || !newAssignment.description || !newAssignment.dueDate || !profile.course) return;

    const assignmentData = {
      title: newAssignment.title,
      description: newAssignment.description,
      course: profile.course, // Faculty member's assigned course
      dueDate: Timestamp.fromDate(new Date(newAssignment.dueDate)),
      postedBy: profile.name,
      postedAt: Timestamp.now(),
    };

    const assignmentsCollectionRef = collection(db, `artifacts/${appId}/public/data/assignments`);
    
    try {
      await addDoc(assignmentsCollectionRef, assignmentData);
      setNewAssignment({ title: '', description: '', dueDate: '', course: profile.course }); // Reset form
    } catch (e) {
      console.error("Error posting assignment:", e);
    }
  }, [db, newAssignment, profile.course, profile.name]);

  const handlePostSchedule = useCallback(async (e) => {
    e.preventDefault();
    if (!db || !newSchedule.location || !newSchedule.time || !newSchedule.day || !profile.course) return;

    const scheduleData = {
      course: profile.course, // Faculty member's assigned course
      location: newSchedule.location,
      time: newSchedule.time,
      day: newSchedule.day,
      instructor: profile.name, // Faculty member's name
      postedAt: Timestamp.now(),
    };

    const scheduleCollectionRef = collection(db, `artifacts/${appId}/public/data/schedule`);

    try {
      await addDoc(scheduleCollectionRef, scheduleData);
      setNewSchedule({ course: profile.course, location: '', time: '', day: 'Monday', instructor: profile.name }); // Reset form
    } catch (e) {
      console.error("Error posting schedule:", e);
    }
  }, [db, newSchedule, profile.course, profile.name]);

  // --- Sub-Components ---

  const AssignmentCard = ({ assignment }) => {
    const dueString = assignment.dueDate ? assignment.dueDate.toLocaleDateString() : 'N/A';
    
    return (
      <div className="p-4 mb-3 bg-white rounded-lg shadow-md border-l-4 border-red-500">
        <h3 className="text-lg font-semibold text-gray-800">{assignment.title}</h3>
        <p className="text-sm mt-1 italic text-gray-500">{assignment.course} | Due: {dueString}</p>
        <p className="text-sm text-gray-600 mt-2">{assignment.description}</p>
      </div>
    );
  };

  const ScheduleEntry = ({ entry }) => (
    <div className="flex items-center p-4 mb-3 bg-white rounded-lg shadow-sm border-l-4 border-green-500">
      <div className="flex-shrink-0 w-16 text-center">
        <Clock className="w-6 h-6 text-green-500 mx-auto" />
        <p className="text-xs font-medium text-gray-600 mt-1">{entry.time}</p>
      </div>
      <div className="ml-4 border-l pl-4">
        <h3 className="text-lg font-semibold text-gray-800">{entry.course}</h3>
        <p className="text-sm text-gray-600">{entry.location} - Day: {entry.day}</p>
        <p className="text-xs text-green-500 font-medium">Instructor: {entry.instructor}</p>
      </div>
    </div>
  );

  const AddAssignmentForm = () => (
    <form onSubmit={handlePostAssignment} className="bg-white p-6 rounded-xl shadow-lg space-y-4">
      <h3 className="text-xl font-bold text-gray-800 flex items-center"><ListPlus className="w-5 h-5 mr-2" /> Create New Assignment</h3>
      <p className="text-sm text-indigo-600">Posting for Course: **{profile.course}**</p>
      <input
        type="text"
        name="title"
        placeholder="Assignment Title (e.g., Final Project Proposal)"
        value={newAssignment.title}
        onChange={handleAssignmentChange}
        required
        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
      />
      <textarea
        name="description"
        placeholder="Detailed description of the assignment..."
        value={newAssignment.description}
        onChange={handleAssignmentChange}
        required
        rows="3"
        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
      />
      <div className="flex space-x-4">
        <label className="flex-1 block">
          <span className="text-sm text-gray-600">Due Date</span>
          <input
            type="date"
            name="dueDate"
            value={newAssignment.dueDate}
            onChange={handleAssignmentChange}
            required
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 mt-1"
          />
        </label>
        {/* Course selection is disabled as the faculty is assumed to teach only one course for simplicity */}
        <label className="flex-1 block">
          <span className="text-sm text-gray-600">Course</span>
          <select 
            name="course" 
            value={profile.course}
            disabled 
            className="w-full p-3 border border-gray-300 bg-gray-100 rounded-lg mt-1"
          >
            <option value={profile.course}>{profile.course}</option>
          </select>
        </label>
      </div>
      <button 
        type="submit"
        className="w-full py-3 bg-red-600 text-white rounded-lg shadow-md hover:bg-red-700 transition font-semibold"
      >
        <span className="flex items-center justify-center"><PlusCircle className="w-5 h-5 mr-2" /> Post Assignment</span>
      </button>
    </form>
  );

  const AddScheduleForm = () => (
    <form onSubmit={handlePostSchedule} className="bg-white p-6 rounded-xl shadow-lg space-y-4">
      <h3 className="text-xl font-bold text-gray-800 flex items-center"><Calendar className="w-5 h-5 mr-2" /> Add New Class/Office Hours</h3>
      <p className="text-sm text-indigo-600">Posting for Course: **{profile.course}**</p>
      <div className="grid grid-cols-2 gap-4">
        <input
          type="text"
          name="location"
          placeholder="Location (e.g., SW-305 or Online)"
          value={newSchedule.location}
          onChange={handleScheduleChange}
          required
          className="col-span-2 md:col-span-1 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
        />
        <input
          type="text"
          name="time"
          placeholder="Time (e.g., 9:00 AM - 10:30 AM)"
          value={newSchedule.time}
          onChange={handleScheduleChange}
          required
          className="col-span-2 md:col-span-1 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
        />
        <label className="col-span-2 md:col-span-1 block">
          <span className="text-sm text-gray-600">Day of the Week</span>
          <select 
            name="day" 
            value={newSchedule.day}
            onChange={handleScheduleChange}
            required
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 mt-1"
          >
            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(day => (
              <option key={day} value={day}>{day}</option>
            ))}
          </select>
        </label>
        <label className="col-span-2 md:col-span-1 block">
            <span className="text-sm text-gray-600">Instructor Name</span>
            <input
                type="text"
                name="instructor"
                value={profile.name}
                disabled
                className="w-full p-3 border border-gray-300 bg-gray-100 rounded-lg mt-1"
            />
        </label>
      </div>
      <button 
        type="submit"
        className="w-full py-3 bg-green-600 text-white rounded-lg shadow-md hover:bg-green-700 transition font-semibold"
      >
        <span className="flex items-center justify-center"><ListPlus className="w-5 h-5 mr-2" /> Post Schedule Update</span>
      </button>
    </form>
  );

  // --- Render Tabs Content ---

  const renderContent = () => {
    if (!isAuthReady) {
      return (
        <div className="flex justify-center items-center h-full">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <p className="ml-3 text-lg text-gray-600">Preparing faculty dashboard...</p>
        </div>
      );
    }
    
    switch (activeTab) {
      case 'assignments':
        return (
          <div className="space-y-8">
            <h2 className="text-3xl font-extrabold text-gray-900">Manage Assignments ({profile.course})</h2>
            <AddAssignmentForm />
            
            <div className="pt-4">
              <h3 className="text-2xl font-bold text-gray-800 mb-4">Posted Assignments</h3>
              <div className="grid md:grid-cols-2 gap-6">
                {assignments.length > 0 ? (
                  assignments.map(assignment => (
                    <AssignmentCard key={assignment.id} assignment={assignment} />
                  ))
                ) : (
                  <div className="md:col-span-2 p-10 text-center bg-gray-50 rounded-xl">
                    <BookOpen className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                    <p className="text-lg text-gray-500">No assignments currently posted for {profile.course}.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'schedule':
        return (
          <div className="space-y-8">
            <h2 className="text-3xl font-extrabold text-gray-900">Manage Schedule ({profile.course})</h2>
            <AddScheduleForm />

            <div className="pt-4">
              <h3 className="text-2xl font-bold text-gray-800 mb-4">Current Schedule</h3>
              <div className="grid md:grid-cols-2 gap-6">
                {schedule.length > 0 ? (
                  schedule.map(entry => (
                    <ScheduleEntry key={entry.id} entry={entry} />
                  ))
                ) : (
                  <div className="md:col-span-2 p-10 text-center bg-gray-50 rounded-xl">
                    <Clock className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                    <p className="text-lg text-gray-500">No schedule entries posted for {profile.course}.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'profile':
        return (
          <div className="space-y-6">
            <h2 className="text-3xl font-extrabold text-gray-900">My Faculty Profile</h2>
            <div className="bg-white p-8 rounded-xl shadow-lg max-w-lg">
              <div className="flex items-center space-x-4 mb-6">
                <User className="w-10 h-10 p-2 bg-red-100 text-red-600 rounded-full" />
                <h3 className="text-xl font-bold text-gray-800">{profile.name}</h3>
              </div>
              <div className="space-y-4">
                <InfoItem label="Faculty ID" value={profile.facultyId || userId.substring(0, 8)} icon={User} />
                <InfoItem label="Email" value={profile.email} icon={Calendar} />
                <InfoItem label="Assigned Course" value={profile.course} icon={BookOpen} />
                <InfoItem label="User ID (for debug)" value={userId} icon={LayoutDashboard} />
              </div>
              <div className="mt-8 pt-4 border-t">
                <p className="text-xs text-gray-500">
                  Your profile is stored privately. All posts you make update the public data used by students.
                </p>
                <a 
                  href="javascript:void(0)" 
                  onClick={() => window.location.href = '/'} 
                  className="mt-4 inline-block text-red-600 hover:text-red-800 font-medium transition"
                >
                  &larr; Back to RBC Main Site
                </a>
              </div>
            </div>
          </div>
        );
        
      default:
        return null;
    }
  };

  const InfoItem = ({ label, value, icon: Icon }) => (
    <div className="flex items-center space-x-3">
      <Icon className="w-5 h-5 text-red-500" />
      <div>
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <p className="text-gray-800 break-all">{value}</p>
      </div>
    </div>
  );

  const NavItem = ({ tab, icon: Icon, label }) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`flex items-center w-full p-3 rounded-lg text-left transition-colors duration-200 
        ${activeTab === tab 
          ? 'bg-red-600 text-white shadow-lg' 
          : 'text-gray-600 hover:bg-gray-100'
        }`
      }
    >
      <Icon className="w-5 h-5 mr-3" />
      <span className="font-medium">{label}</span>
    </button>
  );


  if (loading) {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
            <Loader2 className="w-12 h-12 animate-spin text-red-600 mb-4" />
            <p className="text-xl text-gray-700 font-semibold">Loading Faculty Portal...</p>
        </div>
    );
  }


  return (
    <div className="min-h-screen flex bg-gray-100 font-['Inter']">
      
      {/* Sidebar Navigation (Red themed for Faculty) */}
      <aside className="w-64 bg-white shadow-xl flex flex-col p-4">
        <div className="text-2xl font-black text-red-700 p-2 mb-8">
          RBC <span className="text-gray-800">Faculty</span>
        </div>
        
        <div className="space-y-2 flex-grow">
          <NavItem tab="assignments" icon={BookOpen} label="Manage Assignments" />
          <NavItem tab="schedule" icon={Clock} label="Manage Schedule" />
          <NavItem tab="profile" icon={User} label="My Profile" />
        </div>
        
        {/* User Info Footer */}
        <div className="mt-auto p-4 border-t pt-4">
          <p className="text-sm font-medium text-gray-700">{profile.name}</p>
          <p className="text-xs text-gray-500 break-words">Course: {profile.course}</p>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-7xl mx-auto">
          {renderContent()}
        </div>
      </main>
    </div>
  );
};

export default App;