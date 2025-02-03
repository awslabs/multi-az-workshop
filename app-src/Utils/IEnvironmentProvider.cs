namespace BAMCIS.MultiAZApp.Utils
{
    public interface IEnvironmentProvider
    {
        IEnvironment ResolveEnvironment();
    }
}