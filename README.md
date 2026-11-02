# Ma cave à cafés

Application web pour noter ses cafés de spécialité : scan du sachet, fiches, dégustations, carte des torréfacteurs et boutiques.

- `index.html` : l'application (générée depuis la version de travail).
- `config.js` : adresse et clé publique (anon) du projet Supabase où les fiches sont enregistrées.
- `supabase-setup.sql` : script à exécuter une fois dans Supabase (tables + règles d'accès par code secret).
- `tess/` : moteur de lecture des sachets (Tesseract), exécuté sur le téléphone.

Les données ne sont jamais stockées dans ce dépôt. L'accès se fait par le lien contenant le code secret `?k=…`.
