// Configuraciones de Performance para Fooocus
const PERFORMANCE_CONFIGS = {
    "Quality": {
        mode: "Quality",
        steps: 30,
        cfg_scale: 7,
        sampler: "dpmpp_2m_sde_gpu",
        scheduler: "karras"
    },
    "Speed": {
        mode: "Speed", 
        steps: 15,
        cfg_scale: 4,
        sampler: "dpmpp_2m_sde_gpu",
        scheduler: "karras"
    },
  "Extreme Speed": {
        mode: "Extreme Speed",
        steps: 2,
        cfg_scale: 4,
        sampler: "dpmpp_2m_sde_gpu", 
        scheduler: "karras"
    },
    "Lightning": {
        mode: "Lightning",
        steps: 2,
        cfg_scale: 1,
        sampler: "dpmpp_2m_sde_gpu",
        scheduler: "karras"
    },
    "Hyper-SD": {
        mode: "Hyper-SD",
        steps: 1,
        cfg_scale: 1,
        sampler: "dpmpp_2m_sde_gpu",
        scheduler: "karras"
    }
};

module.exports = PERFORMANCE_CONFIGS;
