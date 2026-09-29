const modules = import.meta.glob('./fr/*.json', { eager: true });
export default Object.assign({}, ...Object.values(modules).map((mod) => mod.default || mod));
