/**
 * Static U-Bahn station data for Vienna.
 * Extracted from vienna-pois.json (subcategory: u-bahn).
 * 99 stations with coordinates, normalized names, and alternate names for compound stations.
 */

export interface UbahnStation {
  /** Display name as stored in the POI data */
  name: string;
  /** Lowercased, umlaut-normalized name for matching */
  normalizedName: string;
  /** Alternate names for compound stations (e.g. "Burggasse-Stadthalle" → ["Burggasse", "Stadthalle"]) */
  alternateNames: string[];
  lat: number;
  lon: number;
}

/** Normalize text for matching: lowercase + replace umlauts with ASCII equivalents. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

function station(
  name: string,
  lat: number,
  lon: number,
  alternateNames: string[] = [],
): UbahnStation {
  return {
    name,
    normalizedName: normalize(name),
    alternateNames,
    lat,
    lon,
  };
}

export const VIENNA_UBAHN_STATIONS: readonly UbahnStation[] = [
  station('Schönbrunn', 48.186047, 16.318955),
  station('Am Schöpfwerk', 48.160715, 16.32423),
  station('Stubentor', 48.206816, 16.379131),
  station('Simmering', 48.169649, 16.4207),
  station('Meidling Hauptstraße', 48.183645, 16.327765),
  station('Friedensbrücke', 48.227767, 16.364012),
  station('Heiligenstadt', 48.248452, 16.365811),
  station('Längenfeldgasse', 48.184802, 16.334943),
  station('Siebenhirten', 48.130515, 16.309837),
  station('Jägerstraße', 48.235217, 16.368637),
  station('Erlaaer Straße', 48.141922, 16.316531),
  station('Floridsdorf', 48.256205, 16.400442),
  station('Seestadt', 48.226254, 16.508438),
  station('Stadlau', 48.219817, 16.449663),
  station('Hausfeldstraße', 48.23341, 16.485773),
  station('Aspernstraße', 48.222524, 16.474872),
  station('Donauspital', 48.219419, 16.466612),
  station('Hardeggasse', 48.220896, 16.45775),
  station('Donaustadtbrücke', 48.211769, 16.440125),
  station('Aspern Nord', 48.234508, 16.504494),
  station('Donaumarina', 48.206465, 16.431617),
  station('Stadion', 48.210671, 16.420255),
  station('Krieau', 48.214686, 16.413752),
  station('Messe Prater', 48.217792, 16.404963),
  station('Leopoldau', 48.277518, 16.452139),
  station('Großfeldsiedlung', 48.271011, 16.447882),
  station('Alte Donau', 48.238338, 16.424901),
  station('Aderklaaer Straße', 48.263421, 16.451626),
  station('Nestroyplatz', 48.215092, 16.385114),
  station('Rennbahnweg', 48.257603, 16.449642),
  station('Donauinsel', 48.229228, 16.41136),
  station('Südtiroler Platz', 48.187146, 16.373613),
  station('Kagraner Platz', 48.250223, 16.443256),
  station('Kagran', 48.242959, 16.432858),
  station('Reumannplatz', 48.17499, 16.377905),
  station('Ottakring', 48.211059, 16.311367),
  station('Alaudagasse', 48.153632, 16.382365),
  station('Altes Landgut', 48.161949, 16.383229),
  station('Oberlaa', 48.142192, 16.40043),
  station('Troststraße', 48.169163, 16.380316),
  station('Neulaa', 48.14559, 16.386554),
  station('Alser Straße', 48.216775, 16.341815),
  station('Braunschweiggasse', 48.189412, 16.295803),
  station('Burggasse-Stadthalle', 48.203365, 16.337193, ['Burggasse', 'Stadthalle']),
  station('Erdberg', 48.191425, 16.41414),
  station('Zippererstraße', 48.180439, 16.412066),
  station('Gumpendorfer Straße', 48.190868, 16.337511),
  station('Dresdner Straße', 48.237256, 16.380131),
  station('Herrengasse', 48.209345, 16.365412),
  station('Hietzing', 48.187547, 16.305031),
  station('Johnstraße', 48.197642, 16.32008),
  station('Josefstädter Straße', 48.21155, 16.339161),
  station('Kaisermühlen-VIC', 48.232862, 16.416497, ['Kaisermühlen', 'VIC']),
  station('Kardinal-Nagl-Platz', 48.197559, 16.399883),
  station('Karlsplatz', 48.200462, 16.368679),
  station('Keplerplatz', 48.179192, 16.376184),
  station('Kettenbrückengasse', 48.196615, 16.357976),
  station('Neubaugasse', 48.199173, 16.352275),
  station('Landstraße / Wien Mitte (ÖBB)', 48.206301, 16.383916, [
    'Landstraße',
    'Wien Mitte',
    'Landstrasse',
  ]),
  station('Michelbeuern-AKH', 48.221281, 16.344277, ['Michelbeuern', 'AKH']),
  station('Niederhofstraße', 48.180776, 16.33118),
  station('Nußdorfer Straße', 48.231324, 16.352436),
  station('Ober Sankt Veit', 48.19224, 16.276206),
  station('Perfektastraße', 48.136886, 16.313447),
  station('Philadelphiabrücke bzw. Meidling (ÖBB)', 48.174202, 16.331496, [
    'Philadelphiabrücke',
    'Meidling',
  ]),
  station('Pilgramgasse', 48.192031, 16.354241),
  station('Hütteldorfer Straße', 48.199797, 16.311394),
  station('Praterstern bzw. Wien Nord (ÖBB)', 48.218871, 16.391382, ['Praterstern', 'Wien Nord']),
  station('Spittelau', 48.235631, 16.358433),
  station('Rochusgasse', 48.202085, 16.392254),
  station('Roßauer Lände', 48.222256, 16.367569),
  station('Schottenring', 48.217146, 16.371245),
  station('Schwedenplatz', 48.211806, 16.378366),
  station('Schlachthausgasse', 48.194414, 16.406749),
  station('Schweglerstraße', 48.197801, 16.328519),
  station('Stadtpark', 48.202809, 16.379578),
  station('Kendlerstraße', 48.20454, 16.309147),
  station('Stephansplatz', 48.208047, 16.37153),
  station('Taubstummengasse', 48.193916, 16.370341),
  station('Thaliastraße', 48.207801, 16.338015),
  station('Tscherttegasse', 48.16486, 16.327669),
  station('Unter Sankt Veit', 48.191128, 16.285948),
  station('Volkstheater', 48.204916, 16.35826),
  station('Vorgartenstraße', 48.223629, 16.401076),
  station('Westbahnhof', 48.195838, 16.339602),
  station('Alterlaa', 48.150728, 16.316876),
  station('Währinger Straße-Volksoper', 48.225587, 16.3495, ['Währinger Straße', 'Volksoper']),
  station('Rathaus', 48.210276, 16.355324),
  station('Museumsquartier', 48.202573, 16.361345),
  station('Lina-Loos-Platz', 48.228493, 16.478562),
  station('Zieglergasse', 48.19708, 16.34598),
  station('Schottentor', 48.214527, 16.361836),
  station('Neue Donau', 48.246406, 16.394834),
  station('Handelskai', 48.241861, 16.385703),
  station('Gasometer', 48.185143, 16.417467),
  station('Enkplatz', 48.174719, 16.414797),
  station('Taborstraße', 48.21913, 16.381292),
  station('Hütteldorf', 48.196957, 16.260835),
  station('Margaretengürtel', 48.188484, 16.342954),
];
