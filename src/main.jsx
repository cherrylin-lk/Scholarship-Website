import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, ArrowUpRight, Bookmark, ChevronDown, GraduationCap, Search, SlidersHorizontal, Sparkles, MapPin, Clock3, Menu, X, Building2, HeartHandshake, Sunrise, Info, Globe2, ShieldCheck, Check, Bell, UserRound } from 'lucide-react';
import './styles.css';
import { createDiscovery } from './services/discovery.js';
const discovery = createDiscovery({ source: import.meta.env.VITE_DISCOVERY_SOURCE || 'demo', baseUrl: import.meta.env.VITE_API_BASE_URL });
import { AccountNav, Dialog, PortalProvider, usePortal, Workspace } from './Portal';
import { dateLabel, daysLeft, studyLevels, fundingTypes, levelsOf, fundingOf, isPublic } from './model';
import './redesign.css';

function BrandLogo() {
 const [missing, setMissing] = useState(false);
 // Show only the existing icon and wordmark, matching the supplied compact logo.
 // The SVG viewport excludes the tagline without redrawing or stretching the artwork.
 return missing ? <span className="brand-name">ScholarRise</span> : <svg className="brand-logo" viewBox="0 130 1688 414" role="img" aria-label="ScholarRise" focusable="false"><image href="/scholarrise-logo-black-gold.png" width="1688" height="932" onError={() => setMissing(true)}/></svg>;
}

function App() {
  const { store, setStore, user, view, go, track, today, setAuth, cloudConfigured, cloudStudent, workspaceReady, toggleRemoteSaved, setCatalog, remote, retryWorkspace, authLoading, catalogRevision } = usePortal();
  const apiDiscovery = discovery.source === 'api';
  const [remoteCatalog, setRemoteCatalog] = useState([]);
  const [catalogState, setCatalogState] = useState({ loading: apiDiscovery, error: '' });
  const [reloadCatalog, setReloadCatalog] = useState(0);
  useEffect(() => {
    if (!apiDiscovery) return;
    const controller = new AbortController();
    setCatalogState({ loading: true, error: '' });
    discovery.catalog([], controller.signal).then(items => {
      setRemoteCatalog(items); setCatalog(items); setCatalogState({ loading: false, error: '' });
    }).catch(error => {
      if (!controller.signal.aborted) setCatalogState({ loading: false, error: error.message });
    });
    return () => controller.abort();
  }, [apiDiscovery, reloadCatalog, catalogRevision]);
  const scholarships = (apiDiscovery ? remoteCatalog : store.scholarships).filter(s => isPublic(s));
  const [query, setQuery] = useState('');
  const [degree, setDegree] = useState('');
  const [tab, setTab] = useState('all');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [country, setCountry] = useState('');
  const [university, setUniversity] = useState('');
  const [funding, setFunding] = useState('');
  const [universitySearch, setUniversitySearch] = useState('');
  const bookmarkKey = user?.id || 'guest';
  const saved = apiDiscovery && cloudConfigured && !cloudStudent ? [] : store.bookmarks[bookmarkKey] || [];
  const toggleSave = (id) => { if (apiDiscovery) { toggleRemoteSaved(id); return; } setStore(previous => { const current = previous.bookmarks[bookmarkKey] || []; return { ...previous, bookmarks: { ...previous.bookmarks, [bookmarkKey]: current.includes(id) ? current.filter(item => item !== id) : [...current, id] } }; }); };
  const resetFilters = () => { setQuery(''); setDegree(''); setCountry(''); setUniversity(''); setFunding(''); setUniversitySearch(''); };
  const visible = discovery.filter(scholarships, { country, level: degree, university, funding, query }).filter(s => tab !== 'saved' || saved.includes(s.id));
  function navigate(next) { setTab(next); setMobileOpen(false); go('discover'); setTimeout(() => document.getElementById('scholarships')?.scrollIntoView({ behavior: 'smooth' }), 0); }
  const universities = [...new Set(scholarships.map(s => s.university))];
  const destinations = [...new Set(scholarships.map(s => s.country))];
  function chooseCountry(value) { resetFilters(); setCountry(value); navigate('all'); }
  function showHow() { go('discover'); setMobileOpen(false); setTimeout(() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' }), 0); }
  return <>
    <div className="announcement"><span><Sparkles size={13}/> Your Future Starts Here</span><a href="#scholarships" onClick={() => navigate('all')}>Find your next opportunity <ArrowUpRight size={13}/></a></div>
    <header className="header"><div className="container nav">
      <a className="brand" href="#" onClick={() => go('discover')} aria-label="ScholarRise home"><BrandLogo/></a>
      <button className="menu-button" aria-label="Toggle navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X/> : <Menu/>}</button>
      <nav className={mobileOpen ? 'nav-links open' : 'nav-links'} aria-label="Main navigation"><a className={view === 'discover' && tab === 'all' ? 'active' : ''} href="#scholarships" onClick={() => navigate('all')}>Discover scholarships</a><button onClick={() => { setMobileOpen(false); go('recommendations'); }}>For you</button><button onClick={showHow}>How it works</button><button onClick={() => navigate('saved')}><Bookmark size={17}/> Saved <span className="saved-count">{saved.length}</span></button></nav>
      <AccountNav/>
    </div></header>
    {view !== 'discover' ? <Workspace/> : <main>
      <section className="hero"><div className="container hero-content">
        <div className="hero-layout">
          <div className="hero-copy"><div className="eyebrow"><span/> BIG AMBITIONS. REAL POSSIBILITIES.</div><h1>Find the funding.<br/><span>Build your future.</span></h1><p>Discover scholarships across universities.<br/> Find your fit, keep track of your applications,<br className="desktop-break"/> and take your next step with confidence.</p><div className="hero-actions"><a className="button" href="#scholarships" onClick={() => navigate('all')}>Explore scholarships <ArrowUpRight size={19}/></a><button className="hero-secondary" onClick={showHow}>See how it works <ArrowRight size={17}/></button></div><div className="hero-assurance"><span><Check size={15}/> Explore in one place</span><span><Check size={15}/> Find your fit</span><span><Check size={15}/> Stay on track</span></div></div>
          <div className="hero-visual"><img src="/scholarrise-campus.png" alt="Two university students walking together on a leafy campus" fetchPriority="high"/><div className="hero-photo-label"><span className="hero-photo-icon"><GraduationCap size={24}/></span><div>YOUR NEXT CHAPTER<small>There is a place for your ambition.</small></div></div><div className="journey-card"><span className="journey-icon"><UserRound size={21}/></span><div><strong>{user ? `Welcome back, ${user.name.split(' ')[0]}.` : 'Your journey starts with you.'}</strong><p>{user ? 'Your goals and next steps, all in one place.' : 'Create a profile. Discover your possibilities.'}</p></div><button aria-label={user ? 'Open your workspace' : 'Get started with ScholarRise'} onClick={() => user ? go(user.role === 'student' ? 'overview' : user.role) : setAuth('register')}><ArrowUpRight size={22}/></button></div></div>
        </div>
        <div className="hero-search-heading"><span>LET'S FIND YOUR OPPORTUNITY</span><span>Start with a name, subject, or destination.</span></div>
        <form className="search-box" onSubmit={e => { e.preventDefault(); navigate('all'); }}>
          <Search className="search-icon" size={23}/><input aria-label="Search scholarships" placeholder="Search scholarships, universities, or keywords..." value={query} onChange={e => setQuery(e.target.value)}/>
          <div className="level-select"><GraduationCap size={20}/><select aria-label="Study level" value={degree} onChange={e => setDegree(e.target.value)}><option value="">All Levels</option>{studyLevels.map(level => <option key={level}>{level}</option>)}</select><ChevronDown size={15}/></div>
          <button className="button" type="submit">Find scholarships <ArrowRight size={18}/></button>
        </form>
        <div className="popular">Popular searches: {['Engineering', 'Business', 'Full tuition'].map(term => <button key={term} onClick={() => { resetFilters(); setQuery(term); navigate('all'); }}>{term}<ArrowUpRight size={12}/></button>)}</div>
      </div></section>
      <section className="catalog-stats" aria-label="Current scholarship collection"><div className="container stats-inner">{[{icon: GraduationCap, value: scholarships.length, label: 'Scholarship listings'}, {icon: Building2, value: universities.length, label: 'Universities & institutions'}, {icon: Globe2, value: destinations.length, label: 'Study destinations'}, {icon: Sparkles, value: studyLevels.length, label: 'Study levels'}].map(stat => <div className="catalog-stat" key={stat.label}><stat.icon size={29} strokeWidth={1.4}/><div><strong>{catalogState.loading ? '...' : stat.value}</strong><span>{stat.label}</span></div></div>)}</div><p>Explore what is in the current collection. Real programs and demo awards are clearly labeled.</p></section>
      <section className="container destination-section"><div className="destination-heading"><div className="section-kicker">YOUR AMBITION HAS NO BORDERS</div><h2>Where will your future take you?</h2></div><div className="destination-links">{['Thailand', 'United Kingdom', 'Australia', 'United States', 'Singapore'].filter(c => destinations.includes(c)).map(c => <button key={c} onClick={() => chooseCountry(c)}><MapPin size={17}/>{c}<ArrowUpRight size={16}/></button>)}</div></section>
      <div className="catalog-background"><div className="container catalog" id="scholarships">
      <aside className="sidebar" aria-label="Scholarship filters"><div className="sidebar-heading"><h2><SlidersHorizontal size={17}/> Refine your search</h2><button onClick={resetFilters}>Clear All Filters</button></div>
        <label className="filter-field">Country<select aria-label="Country" value={country} onChange={e => setCountry(e.target.value)}><option value="">All Countries</option>{[...new Set(scholarships.map(s => s.country))].sort().map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="filter-field">University<input aria-label="Search universities" placeholder="Search university options" value={universitySearch} onChange={e => setUniversitySearch(e.target.value)}/><select aria-label="University" value={university} onChange={e => setUniversity(e.target.value)}><option value="">All Universities</option>{[...new Set(scholarships.map(s => s.university))].sort().filter(u => u === university || u.toLowerCase().includes(universitySearch.toLowerCase())).map(u => <option key={u}>{u}</option>)}</select></label>
        <label className="filter-field">Study level<select aria-label="Filter study level" value={degree} onChange={e => setDegree(e.target.value)}><option value="">All Levels</option>{studyLevels.map(l => <option key={l}>{l}</option>)}</select></label>
        <label className="filter-field">Funding<select aria-label="Funding" value={funding} onChange={e => setFunding(e.target.value)}><option value="">All Funding Types</option>{fundingTypes.map(f => <option key={f}>{f}</option>)}</select></label>
        <div className="sidebar-tip"><Sunrise size={27}/><h3>Big dreams start small.</h3><p>Save the opportunities that inspire you. Your next chapter is waiting.</p></div>
      </aside>
      <section className="discovery">
        {apiDiscovery && <div className="collection-note" role="status"><p>{cloudConfigured ? 'Your profile, saved scholarships and application progress are synced to your account. Recommendations and deadline reminders update while you use this site.' : 'API discovery preview. Accounts and workspaces still use the browser demo. Saving and tracking API listings is not enabled yet.'}</p></div>}
        {cloudStudent && remote?.loading && <p role="status">Loading saved scholarships...</p>}
        {cloudStudent && remote?.error && <div className="collection-note" role="alert"><p>{remote.error}</p><button className="secondary-button" disabled={remote?.loading || remote?.busy} onClick={retryWorkspace}>Retry workspace</button></div>}
        {catalogState.loading && <p role="status">Loading scholarships?</p>}
        {catalogState.error && <div className="collection-note" role="alert"><p>Could not load scholarships: {catalogState.error}</p><button className="secondary-button" onClick={() => setReloadCatalog(n => n + 1)}>Retry</button></div>}
        <div className="breadcrumb"><a href="#">Home</a><span>/</span>Scholarships</div>
        <div className="section-heading"><div><div className="section-kicker">OPPORTUNITY STARTS HERE</div><h2>A scholarship for your next chapter.</h2><p>Explore the options. Find the one that moves you forward.</p></div><span className="sample-label"><ShieldCheck size={15}/> Explore & compare</span></div>
        <div className="filter-bar"><div className="tabs"><button className={tab === 'all' ? 'selected' : ''} onClick={() => setTab('all')}>All scholarships <span>{scholarships.length}</span></button><button className={tab === 'saved' ? 'selected' : ''} onClick={() => setTab('saved')}>Saved scholarships <span>{saved.length}</span></button></div><div className="filter-summary"><SlidersHorizontal size={15}/>{!degree ? 'All study levels' : degree}</div></div>
        <div className="results-heading"><p role="status" aria-live="polite"><strong>{visible.length}</strong> {visible.length === 1 ? 'scholarship' : 'scholarships'}{tab === 'saved' ? ' saved' : ' to explore'}</p><span>Curated opportunities</span></div>
        <div className="collection-note"><Info size={19}/><p>Explore real Thai scholarship programs alongside clearly labeled demo awards. Deadlines refer to specific intakes; check official sources before applying.</p></div>
        {query && <div className="search-results">Results for “{query}”<button onClick={() => { setQuery(''); }}>Clear search <X size={13}/></button></div>}
        <div className="cards">{visible.map(s => <article className="scholarship-card" key={s.id}>
          <div className="card-top"><span className={`university-logo ${s.color}`}>{s.initials}<span>✦</span></span><span className={`tag ${s.tag === 'Fully funded' ? 'funded' : ''}`}>{fundingOf(s)}</span><span className="tag">{s.realProgram ? 'Real program' : 'Demo award'}</span><button className={`save-button ${saved.includes(s.id) ? 'is-saved' : ''}`} aria-label={`${saved.includes(s.id) ? 'Unsave' : 'Save'} ${s.name}`} aria-pressed={saved.includes(s.id)} disabled={apiDiscovery && (!cloudConfigured || authLoading || (user && (!cloudStudent || !workspaceReady)))} onClick={() => toggleSave(s.id)}><Bookmark size={20} fill={saved.includes(s.id) ? 'currentColor' : 'none'}/></button></div>
          <div className="university-name"><Building2 size={13}/>{s.university}</div><h3>{s.name}</h3><div className="card-meta"><span><MapPin size={13}/>{s.country}</span><span><GraduationCap size={14}/>{levelsOf(s).join(', ')}</span></div><p className="card-description">{s.description}</p>
          <div className="award-label">FUNDING & COVERAGE</div><div className="award"><strong>{s.amount}</strong><span>{s.coverage}</span></div><div className="card-bottom"><span><Clock3 size={14}/>{!s.deadline ? 'Check deadline' : daysLeft(s.deadline, today) < 0 ? `Closed ${dateLabel(s.deadline)}` : `Due ${dateLabel(s.deadline)}`}</span><button onClick={() => setSelected(s)}>View details <ArrowUpRight size={16}/></button></div>
        </article>)}</div>
        {!catalogState.loading && !catalogState.error && !visible.length && <div className="empty-state"><Search size={30}/><h3>{tab === 'saved' ? 'No saved scholarships match these filters.' : 'No scholarships found.'}</h3><p>{tab === 'saved' ? 'Save scholarships using the bookmark, or reset your filters.' : 'Try another keyword or reset your filters.'}</p><button className="button" onClick={() => { setTab('all'); resetFilters(); }}>Explore all scholarships <ArrowRight size={17}/></button></div>}
        <p className="demo-note">Check the official university announcement before applying. Demo awards are for exploration only.</p>
      </section></div></div>
      <section className="benefits-section"><div className="container"><div className="benefits-heading"><div className="section-kicker">LESS SEARCHING. MORE POSSIBILITY.</div><h2>Every step forward,<br/><span>a little easier.</span></h2><p>From your first search to your next application,<br/>keep your scholarship journey moving.</p></div><div className="benefits-grid">{[{icon: Search, title: 'Discover more', text: 'Explore scholarship opportunities across countries, universities, and study levels.'}, {icon: Sparkles, title: 'Find your fit', text: 'Use your profile and academic preferences to explore relevant recommendations.'}, {icon: Bookmark, title: 'Keep it together', text: 'Save the opportunities you like and manage your application progress in one place.'}, {icon: Bell, title: 'Remember what matters', text: 'See in-app reminders for upcoming deadlines on the awards you save or track.'}].map(item => <article key={item.title}><span><item.icon size={25}/></span><h3>{item.title}</h3><p>{item.text}</p></article>)}</div></div></section>
      <section className="how-section" id="how-it-works"><div className="container"><div className="section-kicker">A SIMPLE START. A BIGGER FUTURE.</div><h2>Your next chapter, in three steps.</h2><div className="steps">{[{icon: UserRound, title: 'Make it personal', text: 'Create your account and add your study preferences, interests, and academic profile.'}, {icon: Search, title: 'Explore your possibilities', text: 'Search, filter, and compare opportunities. Save the scholarships that feel right for you.'}, {icon: GraduationCap, title: 'Take the next step', text: 'Review the official application requirements, track your progress, and keep an eye on deadlines.'}].map((step, i) => <div className="step" key={step.title}><span className="step-icon"><step.icon size={25}/></span><span className="step-number">0{i + 1}</span><h3>{step.title}</h3><p>{step.text}</p></div>)}</div></div></section>
      <section className="container"><div className="cta-banner"><div><span><Sparkles size={17}/> A WORLD OF OPPORTUNITY</span><h2>Your future is worth exploring.</h2><p>Your ambitions deserve a chance. Let’s find yours.</p></div><a className="button button-white" href="#scholarships" onClick={() => setTab('all')}>Explore scholarships <ArrowRight size={18}/></a></div></section>
    </main>}
    <footer className="container footer"><div><a className="brand" href="#" onClick={() => go('discover')} aria-label="ScholarRise home"><BrandLogo/></a><p>Multi-University Scholarship Discovery,<br/>Recommendation and Tracking System</p></div><div className="footer-links"><a href="#scholarships" onClick={() => navigate('all')}>Explore scholarships</a><button onClick={showHow}>How it works</button><button onClick={() => go('recommendations')}>Explore recommendations</button><button onClick={() => setAuth('recovery')}>Forgot password?</button></div><div className="footer-right"><span>Your Future Starts Here</span><p>© {new Date().getFullYear()} ScholarRise · Local demonstration</p></div></footer>
    {selected && <Dialog title={selected.name} onClose={() => setSelected(null)}><div className="section-kicker">{selected.realProgram ? 'REAL SCHOLARSHIP PROGRAM' : 'DEMO SCHOLARSHIP'}</div><p>{selected.university} · {selected.country}</p><div className="award"><strong>{selected.amount}</strong><span>{selected.coverage}</span></div><p>{selected.description}</p><p><strong>Study level:</strong> {levelsOf(selected).join(', ')}<br/><strong>Funding type:</strong> {fundingOf(selected)}<br/><strong>Fields:</strong> {selected.field}<br/><strong>Minimum GPA:</strong> {selected.minGpa == null ? 'See program requirements' : `${selected.minGpa} / 4`}<br/><strong>Deadline:</strong> {dateLabel(selected.deadline)}</p><p>{selected.deadlineNote}</p>{selected.realProgram && <p>Sources checked: {dateLabel(selected.verifiedOn)}. <a className="text-link" href={selected.sourceUrl || selected.applicationUrl} target="_blank" rel="noopener noreferrer">Official source</a></p>}<p><strong>Eligibility requirements:</strong> {selected.eligibility || 'Contact the university for full eligibility requirements.'}</p><p><strong>Required documents:</strong> {selected.documents || 'Contact the university for the required document list.'}</p>{/^https?:\/\//i.test(selected.applicationUrl || '') && <a className="secondary-button" href={selected.applicationUrl} target="_blank" rel="noopener noreferrer">Official application link <ArrowUpRight size={16}/></a>}<p className="modal-note">{selected.realProgram ? 'Confirm current eligibility, coverage and availability with the university.' : 'Fictional demonstration award.'} Tracking records your progress locally and does not send an application.</p><div className="action-row"><button className="secondary-button" disabled={apiDiscovery && (!cloudConfigured || authLoading || (user && (!cloudStudent || !workspaceReady)))} onClick={() => toggleSave(selected.id)}><Bookmark size={17}/>{saved.includes(selected.id) ? 'Unsave' : 'Save scholarship'}</button><button className="button" disabled={(apiDiscovery && (!cloudConfigured || authLoading || (user && (!cloudStudent || !workspaceReady)))) || daysLeft(selected.deadline, today) < 0} onClick={() => { track(selected); setSelected(null); }}>{daysLeft(selected.deadline, today) < 0 ? 'Deadline passed' : 'Track application'}</button></div></Dialog>}
  </>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><PortalProvider><App/></PortalProvider></React.StrictMode>);

