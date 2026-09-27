/* =====================================================================================
   FOOTBALL CAREER 27 — THE UNIVERSE  (season-start snapshot, 2026/27)
   ---------------------------------------------------------------------------
   This file is the whole world. The engine in index.html reads `window.FC27_DB` and
   nothing else about real football, so to update the game you replace THIS file —
   you never touch the simulation.

   SCHEMA  (all club/player/coach rows are '|'-delimited strings, compact on purpose)

   nations:  "CODE|Name|Strength|Confed"                      strength 40-92
   leagues:  { code, name, confed, tv (money multiplier), divisions: [ [clubs], [clubs] ],
               promotion / relegation rules — see PLAYOFF NOTES below }
   clubs:    "Name|SHORT|Strength|stadiumCapacity|networth"   strength 55-92
   players:  "Name|NAT|POS|OVR|AGE|clubCode"                   (see PLAYER POOL)
   coaches:  "Name|NAT|Tactic|Age|clubCode"                    tactic → COACH_TACTICS
   forms:    default attribute template per position (used to turn one OVR number
             into six attributes; `seed` adds per-player variance)

   PLAYOFF NOTES — real 2026 rules, per league, enforced at week 38:
     ENG  up: 2 automatic + play-off (3rd v 6th, 4th v 5th, two legs, one-off final)
          down: 3 automatic (18th, 19th, 20th)
     ESP  up: 3 automatic (1st, 2nd, 3rd)          down: 3 automatic
     GER  down: 15th plays the 2.BL 3rd over two legs (Relegations-Playoff); 17th, 18th automatic
          up:   2 automatic + 3rd plays Bundesliga 16th over two legs
     ITA  up: 2 automatic + 3rd via "Ferrovia" test (play-off only if within 5 pts) ; down: 3 automatic
     FRA  up: 2 automatic  down: 16th v Ligue 2 3rd playoff (two legs), 17th, 18th automatic
   ===================================================================================== */
window.FC27_DB = {
  meta: { snapshot: '2026/27 season start', updated: '2026-07-01', source: 'hand-built seed — replace me' },

  confeds: { UEFA: 1.00, CONMEBOL: 0.95, CAF: 0.80, AFC: 0.76, CONCACAF: 0.78, OFC: 0.60 },

  nations: [
    'ARG|Argentina|90|CONMEBOL', 'ESP|Spain|92|UEFA', 'FRA|France|91|UEFA', 'BRA|Brazil|90|CONMEBOL',
    'ENG|England|90|UEFA', 'POR|Portugal|89|UEFA', 'NED|Netherlands|87|UEFA', 'GER|Germany|87|UEFA',
    'BEL|Belgium|85|UEFA', 'CRO|Croatia|85|UEFA', 'ITA|Italy|85|UEFA', 'URU|Uruguay|84|CONMEBOL',
    'COL|Colombia|84|CONMEBOL', 'MAR|Morocco|83|CAF', 'SUI|Switzerland|82|UEFA', 'DEN|Denmark|82|UEFA',
    'AUT|Austria|81|UEFA', 'UKR|Ukraine|80|UEFA', 'SEN|Senegal|80|CAF', 'JPN|Japan|80|AFC',
    'USA|United States|79|CONCACAF', 'SCO|Scotland|78|UEFA', 'NOR|Norway|78|UEFA', 'MEX|Mexico|78|CONCACAF',
    'POL|Poland|77|UEFA', 'ECU|Ecuador|77|CONMEBOL', 'SRB|Serbia|77|UEFA', 'BIH|Bosnia-Herzegovina|73|UEFA', 'KOR|South Korea|76|AFC',
    'CIV|Ivory Coast|76|CAF', 'TUR|Turkey|76|UEFA', 'PER|Peru|75|CONMEBOL', 'CHI|Chile|74|CONMEBOL',
    'NGA|Nigeria|74|CAF', 'ALG|Algeria|74|CAF', 'SWE|Sweden|74|UEFA', 'CZE|Czechia|74|UEFA',
    'PAR|Paraguay|74|CONMEBOL', 'WAL|Wales|72|UEFA', 'AUS|Australia|71|AFC', 'CAN|Canada|71|CONCACAF',
    'ROU|Romania|70|UEFA', 'VEN|Venezuela|70|CONMEBOL', 'IRN|Iran|70|AFC', 'CRC|Costa Rica|68|CONCACAF',
    'MLI|Mali|68|CAF', 'PAN|Panama|67|CONCACAF', 'RSA|South Africa|66|CAF', 'KAZ|Kazakhstan|63|UEFA',
    'ISL|Iceland|63|UEFA', 'IRL|Ireland|62|UEFA', 'SVN|Slovenia|62|UEFA', 'SLO|Slovakia|62|UEFA', 'GAB|Gabon|58|CAF', 'ISR|Israel|60|UEFA', 'SUR|Suriname|60|CONCACAF', 'HUN|Hungary|63|UEFA', 'ALB|Albania|63|UEFA', 'GEO|Georgia|63|UEFA',
    'GRE|Greece|62|UEFA', 'EGY|Egypt|66|CAF', 'TUN|Tunisia|65|CAF', 'CMR|Cameroon|65|CAF',
    'GHA|Ghana|64|CAF', 'JAM|Jamaica|64|CONCACAF', 'HON|Honduras|62|CONCACAF', 'QAT|Qatar|60|AFC',
    'KSA|Saudi Arabia|60|AFC', 'CHN|China|56|AFC', 'IND|India|52|AFC', 'NZL|New Zealand|55|OFC'
  ],

  /* ---- coach tactics: how a manager changes YOUR match, not just the result ---- */
  tactics: {
    tikiTaka:   { n:'Tiki-Taka',       chance:.92, pass:.14, shot:-.10, clean:.06, kids:.10, d:'340 passes a game, half of them sideways. You touch it constantly and shoot rarely.' },
    gegenpress: { n:'Gegenpressing',   chance:1.24, pass:-.04, shot:.10, clean:-.05, kids:.14, d:'High line, chaotic, 90 minutes of transitions. Volume of chances, zero rest.' },
    possession: { n:'Positional Play',  chance:1.08, pass:.08, shot:.04, clean:.03, kids:.05, d:'Structure over chaos. You get into good areas, slowly.' },
    counter:    { n:'Low Block & Counter', chance:.86, pass:-.06, shot:.16, clean:.16, kids:-.05, d:'They sit, you run. Fewer chances, better ones, clean sheets available.' },
    direct:     { n:'Direct / Route One', chance:.95, pass:-.14, shot:.12, clean:.05, kids:-.10, d:'Long ball to the big man. If you are not tall, you will eat breakfast on the bench.' },
    vertical:   { n:'Vertical Tiki-Taka', chance:1.12, pass:.06, shot:.08, clean:0, kids:.06, d:'Fast forwards, no sideways safety. Great for numbers, brutal for turnovers.' },
    lowblock:   { n:'Park the Bus',     chance:.78, pass:-.10, shot:.04, clean:.24, kids:-.14, d:'Two banks of four, one long ball, and a clean sheet on the team sheet.' },
    hybrid:     { n:'Pragmatic Hybrid', chance:1.00, pass:0, shot:0, clean:.05, kids:.02, d:'Changes shape to the opponent. Nothing flashy, plenty of points.' },
    altruist:   { n:'Youth Builder',   chance:.95, pass:.05, shot:.02, clean:-.02, kids:.30, d:'Plays teenagers because he develops them. Your minutes are safe; your results are not.' }
  },

  leagues: [
    { code:'ENG', name:'England', confed:'UEFA', tv:1.00,
      divs: [
        { code:'PL', name:'Premier League', rep:1.00, size:20, cup:'FA Cup',
          clubs: [
            'Arsenal|ARS|89|60704|4.9B', 'Manchester City|MCI|88|61474|3.2B', 'Liverpool|LIV|87|61276|4.4B',
            'Chelsea|CHE|84|40344|3.1B', 'Tottenham Hotspur|TOT|82|62850|2.4B', 'Aston Villa|AVL|81|42918|1.6B',
            'Newcastle United|NEW|80|52305|0.9B', 'Manchester United|MUN|80|74310|3.7B',
            'Brighton & Hove Albion|BHA|77|31800|1.1B', 'Nottingham Forest|NFO|76|30445|0.8B',
            'AFC Bournemouth|BOU|76|11306|0.6B', 'Fulham|FUL|74|31168|0.7B', 'Crystal Palace|CRY|74|25481|0.9B',
            'Brentford|BRE|72|17250|0.5B', 'Everton|EVE|72|39414|0.6B', 'West Ham United|WHU|71|62500|0.9B',
            'Sunderland|SUN|70|49000|0.7B', 'Wolverhampton Wanderers|WOL|68|30064|0.5B',
            'Leeds United|LEE|67|37608|0.5B', 'Burnley|BUR|65|22546|0.4B' ] },
        { code:'FLC', name:'EFL Championship', rep:.60, size:20, cup:'League Cup',
          clubs: [
            'Sheffield United|SHU|73|30333|0.3B', 'West Bromwich Albion|WBA|72|26850|0.3B',
            'Middlesbrough|MID|72|55528|0.3B', 'Watford|WAT|71|21577|0.3B', 'Norwich City|NOR|71|27050|0.3B',
            'Swansea City|SWA|70|27250|0.2B', 'Coventry City|COV|70|32609|0.2B', 'Millwall|MWL|69|20062|0.2B',
            'Hull City|HUL|69|24598|0.2B', 'Bristol City|BRI|68|26958|0.2B', 'Derby County|DER|68|33597|0.2B',
            'Queens Park Rangers|QPR|68|18447|0.3B', 'Stoke City|STO|67|36350|0.2B', 'Blackburn Rovers|BLB|67|31311|0.2B',
            'Preston North End|PRE|66|23404|0.2B', 'Charlton Athletic|CHA|66|27111|0.2B', 'Oxford United|OXF|65|12586|0.1B',
            'Wrexham|WRE|65|10771|0.2B', 'Birmingham City|BIR|64|29411|0.2B', 'Portsmouth|POR|63|20899|0.2B' ] } ],
      promotion: { auto: 2, playoff: [3, 4, 5, 6], legs: 2, final: 'single', finalName: 'Play-off Final at Wembley' },
      relegation: { auto: 3, playoff: null } },

    { code:'ESP', name:'Spain', confed:'UEFA', tv:.78,
      divs: [
        { code:'LAL', name:'La Liga', rep:.96, size:20, cup:'Copa del Rey',
          clubs: [
            'Real Madrid|RMA|91|81044|4.2B', 'Barcelona|BAR|91|50367|3.4B', 'Atlético Madrid|ATM|86|70461|1.7B',
            'Athletic Club|ATH|82|53261|0.6B', 'Villarreal|VIL|81|23520|0.6B', 'Real Betis|BET|79|60721|0.5B',
            'Sevilla|SEV|76|43883|0.5B', 'Celta Vigo|CEL|76|29000|0.4B', 'Real Sociedad|RSO|75|39500|0.5B',
            'Valencia|VAL|74|49430|0.5B', 'Girona|GIR|73|13400|0.3B', 'Rayo Vallecano|RAY|72|14700|0.2B',
            'Osasuna|OSA|72|23576|0.2B', 'Espanyol|ESP|71|40000|0.3B', 'Mallorca|MAL|71|24251|0.2B',
            'Getafe|GET|70|17393|0.2B', 'Alavés|ALA|68|19840|0.1B', 'Levante|LEV|67|25354|0.1B',
            'Real Oviedo|OVI|66|30500|0.1B', 'Elche|ELC|66|33984|0.1B' ] },
        { code:'LAB', name:'LaLiga Hypermotion', rep:.62, size:20, cup:'—',
          clubs: [
            'Racing Santander|RAC|71|22251|0.1B', 'Sporting Gijón|SPG|70|26199|0.1B', 'Real Zaragoza|ZAR|70|18424|0.1B',
            'Deportivo La Coruña|DEP|70|32958|0.1B', 'CD Tenerife|TEN|69|22927|0.1B', 'Eibar|EIB|69|8164|0.1B',
            'Albacete|ALB|68|17500|0.1B', 'Burgos CF|BRG|68|12000|0.1B', 'Huesca|HUE|67|8118|0.1B',
            'Racing de Ferrol|FER|67|11000|0.05B', 'FC Cartagena|CAR|66|15128|0.05B', 'CD Mirandés|MIR|66|6444|0.05B',
            'SD Ponferradina|PON|66|8590|0.05B', 'Cádiz CFC|CAD|66|20724|0.1B', 'FC Andorra|AND|65|5500|0.05B',
            'UD Las Palmas|LAS|65|31250|0.1B', 'CD Castellón|CAS|65|15500|0.05B', 'Córdoba CF|COR|64|21833|0.05B',
            'Almería|ALM|64|15474|0.05B', 'Real Valladolid|VLL|63|25000|0.1B' ] } ],
      promotion: { auto: 3, playoff: null },
      relegation: { auto: 3, playoff: null } },

    { code:'GER', name:'Germany', confed:'UEFA', tv:.80,
      divs: [
        { code:'BUN', name:'Bundesliga', rep:.92, size:18, cup:'DFB-Pokal',
          clubs: [
            'Bayern München|FCB|90|75000|2.1B', 'Bayer 04 Leverkusen|B04|86|30210|1.0B',
            'Borussia Dortmund|BVB|84|81365|0.7B', 'RB Leipzig|RBL|83|47069|0.5B',
            'VfB Stuttgart|VFB|80|60469|0.5B', 'Eintracht Frankfurt|SGE|79|58000|0.5B',
            'SC Freiburg|SCF|74|34700|0.3B', 'TSG Hoffenheim|TSG|74|30150|0.3B',
            'VfL Wolfsburg|WOB|74|30000|0.4B', 'Borussia Mönchengladbach|BMG|73|54057|0.3B',
            '1. FSV Mainz 05|MAIN|73|34000|0.2B', '1. FC Union Berlin|UNB|72|22012|0.2B',
            'FC Augsburg|FCA|71|42055|0.2B', 'SV Werder Bremen|SVW|71|42100|0.2B',
            '1. FC Köln|KOE|70|50000|0.3B', 'Hamburger SV|HSV|69|57000|0.3B',
            'FC St. Pauli|STP|67|29546|0.1B', '1. FC Heidenheim|FCH|66|15000|0.1B' ] },
        { code:'B2L', name:'2. Bundesliga', rep:.64, size:18, cup:'—',
          clubs: [
            'FC Schalke 04|S04|72|62271|0.2B', 'Hertha BSC|BSC|71|74667|0.2B', '1. FC Nürnberg|FCN|70|50000|0.1B',
            '1. FC Kaiserslautern|FCK|70|49780|0.1B', 'Karlsruher SC|KSC|69|29699|0.1B',
            'Hannover 96|H96|69|49000|0.1B', 'SV Elversberg|ELV|68|10000|0.05B', 'SC Paderborn|SCP|68|15000|0.1B',
            'SV Darmstadt 98|SV98|68|17000|0.1B', '1. FC Magdeburg|FCM|67|30098|0.1B',
            'Greuther Fürth|SGF|67|16000|0.1B', 'Eintracht Braunschweig|EBS|66|23915|0.05B',
            'Fortuna Düsseldorf|F95|66|54600|0.1B', 'Preußen Münster|MÜN|65|16000|0.05B',
            'SSV Ulm 1846|ULM|65|19500|0.05B', 'Dynamo Dresden|DDG|64|32066|0.05B',
            'Arminia Bielefeld|DSC|64|26515|0.05B', 'Hansa Rostock|HRO|63|29000|0.05B' ] } ],
      /* 16th plays the 2.BL 3rd over two legs; 2.BL 3rd plays the Bundesliga 16th. */
      promotion: { auto: 2, playoff: [3], legs: 2, cross: true, finalName: 'Promotion Play-off (vs Bundesliga 16th)' },
      relegation: { auto: 2, playoff: [16], legs: 2, cross: true, finalName: 'Abstieg-Relegation (vs 2. Bundesliga 3rd)' } },

    { code:'ITA', name:'Italy', confed:'UEFA', tv:.70,
      divs: [
        { code:'SEA', name:'Serie A', rep:.88, size:20, cup:'Coppa Italia',
          clubs: [
            'Inter|INT|88|75923|1.2B', 'Napoli|NAP|86|54726|0.9B', 'AC Milan|MIL|84|75923|1.0B',
            'Juventus|JUV|83|41507|0.8B', 'AS Roma|ROM|82|67598|0.7B', 'Atalanta|ATA|82|24692|0.5B',
            'Lazio|LAZ|79|70634|0.5B', 'Bologna|BOL|78|38279|0.4B', 'Como|COM|75|13987|0.3B',
            'Fiorentina|FIO|74|43147|0.4B', 'Udinese|UDI|72|25144|0.2B', 'Genoa|GEN|71|33205|0.2B',
            'Torino|TOR|71|28140|0.2B', 'Parma|PAR|70|21083|0.2B', 'Cagliari|CAG|69|16237|0.1B',
            'Cremonese|CRE|68|16038|0.1B', 'Sassuolo|SAS|68|21584|0.1B', 'Lecce|LEC|67|33876|0.1B',
            'Verona|VER|66|31682|0.1B', 'Pisa|PIS|65|14679|0.1B' ] },
        { code:'SEB', name:'Serie B', rep:.58, size:20, cup:'—',
          clubs: [
            'Sampdoria|SAM|71|32676|0.1B', 'Palermo|PAL|70|36349|0.1B', 'Monza|MONZ|70|15039|0.1B',
            'Venezia|VEN|69|11500|0.1B', 'Empoli|EMP|69|16800|0.1B', 'Frosinone|FRO|68|10700|0.05B',
            'Spezia|SPE|68|11466|0.05B', 'Reggiana|REG|67|20084|0.05B', 'Catanzaro|CAT|67|14379|0.05B',
            'Brescia|BRE2|67|19456|0.05B', 'Modena|MOD|66|21151|0.05B', 'Mantova|MAN|66|15530|0.05B',
            'Cosenza|COS|65|15199|0.05B', 'Juve Stabia|JUV2|65|12294|0.05B', 'FC Südtirol|SUDT|65|5144|0.02B',
            'Cesena|CES|64|15408|0.05B', 'Ternana|TER|63|16000|0.02B', 'Avellino|AVL2|63|12131|0.02B',
            'Padova|PAD|62|32326|0.02B', 'Bari|BAR2|62|58271|0.02B' ] } ],
      /* Ferrovia: a 3rd-place play-off only happens when 3rd and 4th are within 5 points. */
      promotion: { auto: 2, playoff: [3, 4, 5, 6], legs: 1, gapRule: 5, finalName: 'Promosso Play-off' },
      relegation: { auto: 3, playoff: null } },

    { code:'FRA', name:'France', confed:'UEFA', tv:.62,
      divs: [
        { code:'L1', name:'Ligue 1', rep:.82, size:18, cup:'Coupe de France',
          clubs: [
            'Paris Saint-Germain|PSG|90|47929|2.2B', 'Olympique de Marseille|OM|82|67394|0.6B',
            'AS Monaco|ASM|80|18000|0.6B', 'LOSC Lille|LIL|79|50186|0.4B', 'Olympique Lyonnais|OL|78|59186|0.4B',
            'OGC Nice|NIC|76|35624|0.3B', 'RC Lens|RCL|75|57580|0.3B', 'RC Strasbourg|RCS|73|26109|0.2B',
            'Stade Brestois|BRE3|72|15097|0.1B', 'Stade Rennais|SRFC|72|29778|0.2B', 'Toulouse FC|TOU|71|33151|0.2B',
            'Paris FC|PFC|70|20000|0.1B', 'FC Nantes|FCN2|68|32083|0.2B', 'AJ Auxerre|AJA|68|18541|0.1B',
            'Angers SCO|ANG|67|18752|0.1B', 'Le Havre AC|HAC|66|25185|0.1B', 'FC Lorient|LOR|66|18115|0.1B',
            'FC Metz|MET|65|25636|0.1B' ] },
        { code:'L2', name:'Ligue 2', rep:.54, size:18, cup:'—',
          clubs: [
            'Stade de Reims|SDR|71|21628|0.2B', 'AS Saint-Étienne|ASSE|71|41965|0.2B',
            'En Avant Guingamp|EAG|69|18378|0.1B', 'SC Bastia|SCB|68|16467|0.05B', 'Clermont Foot|CLR|68|11980|0.05B',
            'Montpellier HSC|MHSC|67|32939|0.1B', 'SM Caen|SMC|67|21215|0.05B', 'Amiens SC|ASC|66|12300|0.05B',
            'ES Troyes|TRO|66|20000|0.05B', 'Pau FC|PAU|65|4950|0.02B', 'Grenoble Foot|GRF|65|20068|0.05B',
            'Annecy FC|ANN|65|15660|0.02B', 'USL Dunkerque|DUN|64|16082|0.02B', 'Rodez AF|ROD|64|7067|0.02B',
            'Red Star FC|RED|63|4446|0.02B', 'AS Nancy|NAN|63|20087|0.02B', 'Stade Lavallois|LAV|63|10500|0.02B',
            'US Boulogne|BOU2|62|9652|0.02B' ] } ],
      promotion: { auto: 2, playoff: [3], legs: 2, cross: true, finalName: 'Barrage d’accession (vs Ligue 1 16th)' },
      relegation: { auto: 2, playoff: [16], legs: 2, cross: true, finalName: 'Barrage de relégation (vs Ligue 2 3rd)' } }
  ],

  /* ============================== PLAYER POOL ==============================
     Enough of a real database to make "play as anyone" work: 5-8 named players
     per top-flight club, 2-3 per second-tier club, plus the superstars the
     golden-boot race is measured against. Ratings are an early-2026 snapshot.
     Anything here can be overwritten by a dataset of the same shape.
  ========================================================================== */
  players: [
    /* --- ENG / Premier League --- */
    'E. Haaland|NOR|ST|93|25|MCI', 'M. Salah|EGY|RW|90|33|LIV', 'B. Saka|ENG|RW|88|24|ARS',
    'Martinelli|BRA|LW|87|24|ARS', 'D. Rice|ENG|CM|88|27|ARS', 'Rodri|ESP|CM|91|29|MCI',
    'Phil Foden|ENG|CAM|89|26|MCI', 'J. Stones|ENG|CB|85|31|MCI', 'V. van Dijk|NED|CB|88|34|LIV',
    'L. Díaz|COL|LW|87|29|LIV', 'A. Mac Allister|ARG|CM|86|27|LIV', 'Cole Palmer|ENG|CAM|89|23|CHE',
    'Enzo Fernández|ARG|CM|86|25|CHE', 'João Pedro|BRA|ST|85|24|CHE', 'Richarlison|BRA|ST|83|29|TOT',
    'Dejan Kulusevski|SWE|RW|84|26|TOT', 'C. Romero|ARG|CB|85|28|TOT', 'Ollie Watkins|ENG|ST|85|30|AVL',
    'Emiliano Buendía|ARG|CAM|83|29|AVL', 'A. Gordon|ENG|LW|84|25|NEW', 'Bruno Guimarães|BRA|CM|86|28|NEW',
    'João Neves|POR|CM|84|21|PSG', 'E. Nketiah|ENG|ST|82|26|NFO', 'M. Murillo|COL|CB|81|23|NFO',
    'A. Semenyo|GHA|LW|83|26|BOU', 'H. Ekitiké|FRA|ST|84|23|LIV', 'B. Sørloth|NOR|ST|83|30|RBL',
    'K. De Bruyne|BEL|CAM|89|34|NOR', 'I. Toney|ENG|ST|83|29|BRE', 'D. Undav|GER|ST|81|30|BRE',
    'Dominic Solanke|ENG|ST|82|28|TOT', 'J. Grealish|ENG|LW|84|30|EVE', 'Calvert-Lewin|ENG|ST|81|28|EVE',
    'T. Ream|USA|CB|79|28|FUL', 'R. Vargas|SUI|CM|78|25|FUL', 'M. Olise|FRA|RW|88|24|FCB',
    /* --- Championship --- */
    'K. Dewsbury-Hall|ENG|CM|78|27|RBL', 'T. Aarons|ENG|RB|77|26|LEE', 'A. Gray|ENG|CAM|76|29|WBA',
    'C. Wood|NZL|ST|79|33|NOR', 'M. Piroe|NED|ST|78|26|COV', 'J. Brownhill|ENG|CM|75|30|BRI',
    'K. Storey|IRL|CM|72|34|SVW', 'L. Ayling|ENG|RB|73|34|LEE', 'D. Fofana|FRA|ST|77|24|WAT',
    /* --- ESP / La Liga --- */
    'L. Yamal|ESP|RW|92|19|BAR', 'R. Lewandowski|POL|ST|89|38|BAR', 'Raphinha|BRA|LW|89|29|BAR',
    'Pedri|ESP|CM|90|23|BAR', 'P. Cubarsí|ESP|CB|85|19|BAR', 'F. de Jong|NED|CM|86|29|BAR',
    'K. Mbappé|FRA|ST|94|27|RMA', 'Vinícius Júnior|BRA|LW|92|26|RMA', 'J. Bellingham|ENG|CAM|91|23|RMA',
    'Federico Valverde|URU|CM|89|28|RMA', 'Thibaut Courtois|BEL|GK|89|34|RMA', 'Á. Carreras|ESP|LB|83|22|RMA',
    'Julián Alvarez|ARG|ST|89|26|ATM', 'A. Griezmann|FRA|CAM|87|35|ATM', 'M. Llorente|ESP|RB|84|31|ATM',
    'N. Williams|ESP|LW|87|23|ATH', 'I. Williams|ESP|ST|84|34|ATH', 'Álex Baena|ESP|CAM|84|24|ATM',
    'A. Grealish|ENG|LW|82|31|VIL', 'Y. En-Nesyri|MAR|ST|80|29|BET', 'Iñaki Williams|GHA|RW|81|32|ATH',
    'G. Guedes|POR|LW|81|29|RAY', 'D. Conde|URU|GK|80|27|ATM', 'R. Le Normand|FRA|CB|82|29|ATM',
    'L. Aquilani|FRA|CM|74|34|OSA', 'Borja Iglesias|ESP|ST|79|32|BET', 'A. Sørloth|NOR|ST|79|30|VIL',
    /* --- GER / Bundesliga --- */
    'F. Wirtz|GER|CAM|91|23|MCI', 'J. Musiala|GER|CAM|89|23|FCB', 'H. Kane|ENG|ST|93|33|FCB',
    'A. Davies|CAN|LB|86|25|FCB', 'M. Kimmich|GER|CM|88|31|FCB',
    'Florian Wirtz|GER|CAM|90|23|B04', 'X. Simons|NED|CAM|86|23|RBL', 'Loïs Openda|BEL|ST|84|26|RBL',
    'S. Gnabry|GER|RW|84|31|FCB', 'N. Schlotterbeck|GER|CB|83|27|RBL', 'D. Kampl|SLO|CM|81|35|B04',
    'S. Haller|CIV|ST|80|33|SGE', 'J. Burkardt|GER|ST|80|25|MAIN', 'T. Beier|GER|RW|79|24|TSG',
    'V. Grimaldo|ESP|LB|83|30|B04', 'E. Can|TUR|CM|82|32|VFB', 'D. Eze|ENG|CAM|85|28|ARS',
    /* --- ITA / Serie A --- */
    'L. Martínez|ARG|ST|90|29|INT', 'M. Thuram|FRA|ST|87|25|INT', 'H. Çalhanoğlu|TUR|CM|87|32|INT',
    'B. Pavard|FRA|CB|83|30|INT', 'Scott McTominay|SCO|CM|85|29|NAP', 'R. Lukaku|BEL|ST|85|33|NAP',
    'K. Kvaratskhelia|GEO|LW|88|25|NAP', 'R. Leão|POR|LW|87|27|MIL', 'Théo Hernández|FRA|LB|86|29|MIL',
    'D. Frattesi|ITA|CM|83|26|INT', 'P. Dybala|ARG|CAM|85|32|ROM', 'M. Soulé|ARG|CAM|82|23|ROM',
    'A. Belotti|ITA|ST|79|32|COM', 'K. Adli|FRA|CM|78|25|COM', 'G. Scamacca|ITA|ST|81|27|ATA',
    'A. Lookman|NGA|RW|86|28|ATA', 'M. Zaccagni|ITA|LW|81|30|LAZ', 'N. Barella|ITA|CM|88|29|INT',
    'F. Acerbi|ITA|CB|79|38|INT', 'L. Pellegrini|ITA|CAM|82|30|ROM',
    /* --- FRA / Ligue 1 --- */
    'O. Dembélé|FRA|RW|89|29|PSG', 'G. Donnarumma|ITA|GK|88|27|PSG', 'Marquinhos|BRA|CB|85|32|PSG',
    'Vitinha|POR|CM|86|26|PSG', 'D. Doué|FRA|RW|83|21|PSG', 'M. Zaire-Emery|FRA|CM|83|21|PSG',
    'P. Aubameyang|GAB|ST|82|37|OM', 'M. Greenwood|ENG|RW|84|24|OM', 'G. Rugani|ITA|CB|78|31|OM',
    'A. Minamino|JPN|CAM|77|31|ASM', 'M. Akliouche|FRA|CAM|80|21|ASM', 'F. Balogun|USA|ST|79|24|ASM',
    'O. Tamari|ISR|CAM|78|28|NIC', 'J. David|CAN|ST|85|26|LIL', 'E. Gudmundsson|ISL|CAM|80|31|NIC',
    'A. Lacazette|FRA|ST|80|35|OL', 'R. Cherki|FRA|CAM|84|23|MCI', 'K. Thomson|SCO|CM|74|30|HAC'
  ],
  regens: {
    first: ['Luca','Noah','Ethan','Mateo','Kai','Yusuf','Adnan','Tiago','Bruno','Ilias','Diego','Mattéo','Jonas','Emre','Rafa','Theo','Alex','Noa','Dylan','Sacha','Gianluca','Milan','Arda','Luka'],
    last: ['Okafor','Bernardi','Traoré','Vidal','Kowalski','Demir','Nakamura','Sørensen','Ferreira','Bakker','Ibrahimaj','Coman','Duarte','Yilmaz','Kusuma','Moretti','Halvorsen','Reyes','Vermeer','Donnarumma','Sylla','Kaya','Novak','Vieira']
  }
};

/* The block above is extended by the loader with these defaults; kept separate so a
   replacement dataset can omit them. */
window.FC27_DB.coaches = [
  /* ---- Premier League ---- */
  'M. Arteta|ESP|possession|44|ARS', 'A. Slot|NED|vertical|43|LIV', 'E. Maresca|ITA|possession|46|MCI',
  'L. Rosenior|FRA|vertical|41|CHE', 'T. Frank|DEN|direct|53|TOT', 'U. Emery|ESP|possession|54|AVL',
  'E. Howe|ENG|counter|44|NEW', 'R. Amorim|POR|vertical|41|MUN', 'F. Hübscher|GER|gegenpress|38|BHA',
  'S. Dyche|ENG|direct|54|NFO', 'A. Iraola|ESP|tikiTaka|43|BOU', 'M. Silva|POR|possession|43|FUL',
  'O. Glasner|AUT|counter|51|CRY', 'K. Andrews|AUS|hybrid|40|BRE', 'D. Moyes|SCO|direct|63|EVE',
  'N. Espírito Santo|POR|hybrid|41|WHU', 'R. Le Bris|FRA|hybrid|55|SUN', 'V. Pereira|POR|hybrid|58|WOL',
  'D. Farke|GER|possession|49|LEE', 'S. Parker|ENG|hybrid|45|BUR',
  /* ---- Championship (style matters: they play you in cups) ---- */
  'C. Wilder|ENG|direct|58|SHU', 'R. Llambrich|ESP|hybrid|47|DER', 'M. Carrick|ENG|possession|44|MWL',
  'W. Schöne|DEN|hybrid|42|NOR', 'L. Hughes|WAL|altruist|46|SWA',
  /* ---- La Liga ---- */
  'X. Alonso|ESP|vertical|44|RMA', 'H. Flick|GER|gegenpress|61|BAR', 'D. Simeone|ARG|counter|56|ATM',
  'E. del Hoyo|ESP|possession|55|ATH', 'M. Guerrero|ESP|hybrid|60|VIL', 'Pellegrini|CHI|possession|73|BET',
  'J. García Pimienta|ESP|tikiTaka|42|SEV', 'C. Giráldez|ESP|possession|36|CEL', 'L. Arrasate|ESP|hybrid|50|ESP',
  'C. Corberán|ESP|counter|42|VAL', 'F. Amaral|POR|altruist|40|OVI',
  /* ---- Bundesliga ---- */
  'V. Kompany|BEL|possession|40|FCB', 'K. Alonso|ESP|vertical|43|B04', 'N. Kovač|CRO|hybrid|52|BVB',
  'O. Rangnick|GER|gegenpress|68|RBL', 'S. Keepa|GER|hybrid|38|SGE', 'J. Leno|GER|altruist|44|MAIN',
  'L. Fazliç|BIH|hybrid|41|SCF', 'D. Jaissle|GER|gegenpress|37|TSG', 'P. Hecking|GER|direct|61|BMG',
  'T. Reis|GER|counter|43|UNB', 'B. Baumgart|GER|direct|52|STP', 'M. Kramny|GER|hybrid|46|FCH',
  /* ---- Serie A ---- */
  'C. Chivu|ROU|possession|45|INT', 'A. Conte|ITA|counter|56|NAP', 'M. Allegri|ITA|lowblock|59|MIL',
  'I. Tudor|CRO|hybrid|48|JUV', 'G. Gasperini|ITA|gegenpress|68|ROM', 'R. Palladino|ITA|hybrid|41|ATA',
  'M. Baroni|ITA|hybrid|46|LAZ', 'V. Italiano|ITA|possession|49|BOL', 'C. Fabregas|ESP|tikiTaka|39|COM',
  'P. Zanetti|ITA|counter|48|FIO', 'F. D’Ambrosio|ITA|altruist|40|CRE', 'J. Stanković|SRB|hybrid|47|UDI',
  'F. Andreazzoli|ITA|lowblock|63|GEN', 'M. Palladino|ITA|direct|41|TOR', 'A. Nesta|ITA|hybrid|50|MONZ',
  /* ---- Ligue 1 ---- */
  'L. Enrique|ESP|tikiTaka|56|PSG', 'R. De Zerbi|ITA|possession|46|OM', 'A. Hütter|AUT|gegenpress|55|ASM',
  'B. Génésio|FRA|hybrid|49|LIL', 'P. Fonseca|POR|vertical|52|OL', 'F. Bose|SUI|hybrid|44|NIC',
  'P. Sage|FRA|direct|66|RCL', 'L. Vieira|POR|hybrid|50|BRE3', 'H. Stéphan|FRA|hybrid|45|SRFC',
  'C. Pélissier|FRA|lowblock|46|TOU', 'R. Guimarães|BRA|hybrid|41|PFC', 'A. Gourvennec|FRA|hybrid|44|FCN2',
  /* ---- National teams ---- */
  'T. Tuchel|ENG|possession|52|INTL:ENG', 'L. de la Fuente|ESP|tikiTaka|65|INTL:ESP',
  'D. Deschamps|FRA|counter|57|INTL:FRA', 'C. Ancelotti|ITA|hybrid|66|INTL:BRA',
  'J. Nagelsmann|GER|possession|39|INTL:GER', 'L. Scaloni|ARG|hybrid|48|INTL:ARG',
  'G. Mancini|ITA|possession|51|INTL:ITA', 'R. Martínez|POR|vertical|46|INTL:POR',
  'R. Koeman|NED|direct|56|INTL:NED', 'I. Ola|CRO|counter|59|INTL:CRO',
  'G. Bloom|BEL|hybrid|53|INTL:BEL', 'E. Rep|SUR|hybrid|55|INTL:SUR',
  'G. Ståhlbäck|SWE|gegenpress|49|INTL:SWE', 'R. Edwards|WAL|direct|52|INTL:WAL',
  'A. Yuran|KAZ|hybrid|54|INTL:KAZ', 'T. Popović|AUS|lowblock|49|INTL:AUS',
  'M. Rey|CAN|hybrid|58|INTL:CAN', 'O. Poch|ARG|gegenpress|47|INTL:USA',
  'M. Barrera|MEX|possession|51|INTL:MEX', 'J. Arce|PAR|hybrid|52|INTL:COL',
  'S. Nkemdirim|NGA|counter|49|INTL:NGA', 'W. Gallas|FRA|hybrid|52|INTL:CMR',
  'H. Kamamoto|JPN|possession|58|INTL:JPN', 'P. dos Santos|BRA|tikiTaka|50|INTL:KOR'
].map(function (r) {
  var p = r.split('|');
  var tag = p[4];
  return { name: p[0], nat: p[1], tactic: p[2], age: +p[3],
           club: tag.indexOf('INTL:') === 0 ? null : tag,
           country: tag.indexOf('INTL:') === 0 ? tag.slice(5) : null };
});

/* position templates: turn one OVR number into six attributes (mean-locked to OVR) */
window.FC27_DB.forms = {
  ST:  { pace: 2, shooting: 6, passing: -4, dribbling: 2, defending: -16, physical: 6 },
  LW:  { pace: 7, shooting: 2, passing: 1, dribbling: 6, defending: -14, physical: -4 },
  RW:  { pace: 7, shooting: 2, passing: 1, dribbling: 6, defending: -14, physical: -4 },
  CAM: { pace: 1, shooting: 3, passing: 7, dribbling: 5, defending: -10, physical: -4 },
  CM:  { pace: -2, shooting: -2, passing: 6, dribbling: 2, defending: 2, physical: 1 },
  CDM: { pace: -3, shooting: -4, passing: 4, dribbling: 0, defending: 9, physical: 6 },
  LB:  { pace: 6, shooting: -4, passing: 4, dribbling: 3, defending: 6, physical: 1 },
  RB:  { pace: 6, shooting: -4, passing: 4, dribbling: 3, defending: 6, physical: 1 },
  CB:  { pace: -4, shooting: -8, passing: 0, dribbling: -6, defending: 12, physical: 8 },
  GK:  { pace: -12, shooting: -22, passing: -8, dribbling: -14, defending: 8, physical: 4 }
};

/* real international calendar: which summer has which trophy, and the confed format */
window.FC27_DB.intlCalendar = {
  worldCup:      { years: [2030, 2034, 2038], teams: 48, weeks: 6, name: 'FIFA World Cup', confed: 'ALL' },
  euro:          { years: [2028, 2032], teams: 24, weeks: 5, name: 'UEFA European Championship', confed: 'UEFA' },
  copaAmerica:   { years: [2027, 2031], teams: 16, weeks: 5, name: 'Copa América', confed: 'CONMEBOL' },
  afcon:         { years: [2027, 2029, 2031], teams: 24, weeks: 4, name: 'Africa Cup of Nations', confed: 'CAF' },
  asianCup:      { years: [2027, 2031], teams: 24, weeks: 4, name: 'AFC Asian Cup', confed: 'AFC' },
  goldCup:       { years: [2027, 2029, 2031], teams: 16, weeks: 3, name: 'CONCACAF Gold Cup', confed: 'CONCACAF' },
  /* Nations League: league phase in Sept/Oct/Nov of the odd season, finals the following June */
  nationsLeague: { startSeason: 1, finalsMonth: 6, groups: 4, name: 'UEFA Nations League' },
  /* international windows inside a domestic season, measured in league rounds */
  windows: [
    { after: 3,  label: 'September window',  kind: 'NL' },
    { after: 9,  label: 'October window',    kind: 'NL' },
    { after: 14, label: 'November window',   kind: 'NL' },
    { after: 26, label: 'March window',      kind: 'QUAL' },
    { after: 32, label: 'June window',       kind: 'QUAL' }
  ],
  lastWorldCup: 2026, lastEuro: 2024
};
